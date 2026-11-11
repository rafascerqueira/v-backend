import { createHash, randomBytes } from 'node:crypto'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import type { TestingModule } from '@nestjs/testing'
import request from 'supertest'
import type { PrismaService } from '../src/shared/prisma/prisma.service'
import { RedisService } from '../src/shared/redis/redis.service'
import {
	SUBSCRIPTION_REPOSITORY,
	type SubscriptionRepository,
} from '../src/shared/repositories/subscription.repository'
import { createE2EApp } from './helpers/e2e'
import {
	type BrowserSession,
	cookieHeader,
	decodeJwt,
	login,
	mergeCookies,
	parseSetCookies,
} from './helpers/session'

/**
 * Sessions (e2e, real auth against Postgres + Redis).
 *
 * What must hold: no token ever travels in a response body; role, plan and status are
 * the account's at the time of the request (no new login needed); every session can
 * be ended; a refresh token is single-use, with a short window for parallel calls.
 */
describe('Sessions (e2e)', () => {
	let app: NestFastifyApplication
	let prisma: PrismaService
	let module: TestingModule

	const seller = {
		name: 'Sessão Seller',
		email: 'sessao-seller@example.com',
		password: 'Password123',
	}
	const admin = { name: 'Sessão Admin', email: 'sessao-admin@example.com', password: 'Password123' }

	const http = () => request(app.getHttpServer())
	const credentials = (user: typeof seller) => ({ email: user.email, password: user.password })

	async function register(user: typeof seller, data: Record<string, unknown> = {}) {
		await http().post('/auth/register').send(user).expect(201)
		return prisma.account.update({ where: { email: user.email }, data })
	}

	const me = (session: BrowserSession) => http().get('/auth/me').set('Cookie', session.cookies)

	const refresh = (session: BrowserSession) =>
		http().post('/auth/refresh').set('Cookie', session.cookies).send({})

	/** A cookie-authenticated mutation, as the SPA sends it (CSRF double-submit). */
	const mutate = (session: BrowserSession, method: 'post' | 'patch' | 'delete', path: string) =>
		http()[method](path).set('Cookie', session.cookies).set('X-CSRF-Token', session.csrf)

	beforeEach(async () => {
		;({ app, prisma, module } = await createE2EApp({ realAuth: true }))
		await prisma.account.deleteMany({ where: { email: { in: [seller.email, admin.email] } } })
	})

	afterEach(async () => {
		await prisma.account.deleteMany({ where: { email: { in: [seller.email, admin.email] } } })
		await app.close()
	})

	describe('login', () => {
		beforeEach(async () => {
			await register(seller)
		})

		it('answers { expiresIn } and never puts a token in the body', async () => {
			const res = await http().post('/auth/login').send(credentials(seller)).expect(200)

			expect(res.body).toEqual({ expiresIn: expect.any(Number) })
			const jar = parseSetCookies(res.headers['set-cookie'])
			expect(JSON.stringify(res.body)).not.toContain(jar.access_token.value)
			expect(JSON.stringify(res.body)).not.toContain(jar.refresh_token.value)
		})

		it('sets the session cookies with the agreed scope and visibility', async () => {
			const res = await http().post('/auth/login').send(credentials(seller)).expect(200)
			const jar = parseSetCookies(res.headers['set-cookie'])

			expect(jar.access_token.attrs).toEqual(expect.arrayContaining(['httponly', 'path=/']))
			// The refresh token is only ever sent to the session endpoints.
			expect(jar.refresh_token.attrs).toEqual(expect.arrayContaining(['httponly', 'path=/auth']))
			expect(jar.csrf_token.attrs).toContain('path=/')
			expect(jar.csrf_token.attrs).not.toContain('httponly')
			// JS-readable hint for the frontend; it grants nothing.
			expect(jar.vd_session.value).toBe('1')
			expect(jar.vd_session.attrs).not.toContain('httponly')
			for (const cookie of Object.values(jar)) {
				expect(cookie.attrs).toContain('samesite=lax')
			}
		})

		it('"keep me signed in" (default) makes the cookies outlive the browser session', async () => {
			const res = await http().post('/auth/login').send(credentials(seller)).expect(200)
			const jar = parseSetCookies(res.headers['set-cookie'])

			const maxAge = (name: string) =>
				Number(jar[name].attrs.find((a) => a.startsWith('max-age='))?.split('=')[1])
			expect(maxAge('refresh_token')).toBe(30 * 86400)
			expect(maxAge('csrf_token')).toBe(30 * 86400)
			expect(maxAge('vd_session')).toBe(30 * 86400)
			expect(maxAge('access_token')).toBe(res.body.expiresIn)
		})

		it('remember=false issues browser-session cookies (no Max-Age, no Expires)', async () => {
			const res = await http()
				.post('/auth/login')
				.send({ ...credentials(seller), remember: false })
				.expect(200)
			const jar = parseSetCookies(res.headers['set-cookie'])

			for (const name of ['access_token', 'refresh_token', 'csrf_token', 'vd_session']) {
				expect(jar[name].attrs.some((a) => a.startsWith('max-age='))).toBe(false)
				expect(jar[name].attrs.some((a) => a.startsWith('expires='))).toBe(false)
			}
		})

		it('issues tokens that carry a session reference and no role, plan or e-mail', async () => {
			const session = await login(app, credentials(seller))

			for (const name of ['access_token', 'refresh_token']) {
				const claims = decodeJwt(session.jar[name].value)
				expect(claims).toMatchObject({ sid: session.sid, sv: 0 })
				expect(typeof claims.jti).toBe('string')
				expect(claims).not.toHaveProperty('role')
				expect(claims).not.toHaveProperty('plan_type')
				expect(claims).not.toHaveProperty('email')
			}
		})

		it('rejects a login posted from a foreign Origin (403 ORIGIN_NOT_ALLOWED)', async () => {
			const res = await http()
				.post('/auth/login')
				.set('Origin', 'https://evil.example')
				.send(credentials(seller))
				.expect(403)

			expect(res.body.code).toBe('ORIGIN_NOT_ALLOWED')
			expect(res.headers['set-cookie']).toBeUndefined()
		})

		it('accepts a login posted from the frontend origin', async () => {
			await http()
				.post('/auth/login')
				.set('Origin', 'http://localhost:3000')
				.send(credentials(seller))
				.expect(200)
		})
	})

	describe('refresh', () => {
		let session: BrowserSession

		beforeEach(async () => {
			await register(seller)
			session = await login(app, credentials(seller))
		})

		it('renews from the cookie, answers { expiresIn } and rotates the refresh token', async () => {
			const res = await refresh(session).expect(200)

			expect(res.body).toEqual({ expiresIn: expect.any(Number) })
			const renewed = mergeCookies(session, res.headers['set-cookie'])
			expect(renewed.jar.refresh_token.value).not.toBe(session.jar.refresh_token.value)
			expect(renewed.csrf).not.toBe(session.csrf)
			// Same session, new tokens.
			expect(renewed.sid).toBe(session.sid)
			await me(renewed).expect(200)
		})

		it('ignores a refresh token sent in the body: only the HttpOnly cookie counts', async () => {
			const res = await http()
				.post('/auth/refresh')
				.send({ refreshToken: session.jar.refresh_token.value })
				.expect(401)

			expect(res.body.code).toBe('SESSION_EXPIRED')
		})

		it('rejects a refresh posted from a foreign Origin (403) and leaves the session intact', async () => {
			const res = await refresh(session).set('Origin', 'https://evil.example').expect(403)

			expect(res.body.code).toBe('ORIGIN_NOT_ALLOWED')
			await refresh(session).expect(200)
		})

		it('does not accept the access token in place of the refresh token', async () => {
			const res = await http()
				.post('/auth/refresh')
				.set('Cookie', `refresh_token=${session.jar.access_token.value}`)
				.send({})
				.expect(401)

			expect(res.body.code).toBe('SESSION_EXPIRED')
		})

		it('10 parallel refreshes with the same cookie leave exactly one live session', async () => {
			const responses = await Promise.all(Array.from({ length: 10 }, () => refresh(session)))

			// Nobody is signed out by the race...
			expect(responses.map((r) => r.status)).toEqual(Array(10).fill(200))
			// ...exactly one call rotated the refresh token; the rest rode the grace window.
			const rotations = responses
				.map((r) => parseSetCookies(r.headers['set-cookie']))
				.filter((jar) => jar.refresh_token)
			expect(rotations).toHaveLength(1)
			// Every access token handed out belongs to the one session.
			for (const res of responses) {
				const jar = parseSetCookies(res.headers['set-cookie'])
				expect(decodeJwt(jar.access_token.value).sid).toBe(session.sid)
				await http()
					.get('/auth/me')
					.set('Cookie', cookieHeader(jar, ['access_token']))
					.expect(200)
			}
			// And the session carries on from the rotated token.
			const winner = mergeCookies(session, [rotations[0].refresh_token.raw])
			await refresh(winner).expect(200)
		})

		it('ends the session when a rotated-out refresh token returns after the grace window', async () => {
			const first = await refresh(session).expect(200)
			const current = mergeCookies(session, first.headers['set-cookie'])
			// Close the grace window without waiting 10 seconds.
			await module
				.get(RedisService)
				.setHashWithExpiry(`auth:session:${session.sid}`, { prev_until: '1' }, 3600)

			const reuse = await refresh(session).expect(401)

			expect(reuse.body.code).toBe('SESSION_REVOKED')
			// The cookies are cleared so the browser stops presenting them.
			const cleared = parseSetCookies(reuse.headers['set-cookie'])
			expect(cleared.refresh_token.value).toBe('')
			expect(cleared.vd_session.value).toBe('')
			// Whoever holds the newest token is signed out as well.
			expect((await me(current).expect(401)).body.code).toBe('SESSION_EXPIRED')
			expect((await refresh(current).expect(401)).body.code).toBe('SESSION_EXPIRED')
		})
	})

	describe('logout', () => {
		let session: BrowserSession

		beforeEach(async () => {
			await register(seller)
			session = await login(app, credentials(seller))
		})

		it('ends the session: neither the access nor the refresh token works afterwards', async () => {
			const res = await http().post('/auth/logout').set('Cookie', session.cookies).expect(200)

			const cleared = parseSetCookies(res.headers['set-cookie'])
			for (const name of ['access_token', 'refresh_token', 'csrf_token', 'vd_session']) {
				expect(cleared[name].value).toBe('')
			}
			// A copy of the old cookies is useless, long before the tokens expire.
			expect((await me(session).expect(401)).body.code).toBe('SESSION_EXPIRED')
			expect((await refresh(session).expect(401)).body.code).toBe('SESSION_EXPIRED')
		})

		it('works with only the refresh cookie (access token already expired)', async () => {
			await http()
				.post('/auth/logout')
				.set('Cookie', cookieHeader(session.jar, ['refresh_token']))
				.expect(200)

			await me(session).expect(401)
		})

		it('answers 200 and clears the cookies when there is no session at all', async () => {
			const res = await http().post('/auth/logout').expect(200)

			expect(parseSetCookies(res.headers['set-cookie']).access_token.value).toBe('')
		})

		it('leaves the other sessions of the account alone', async () => {
			const other = await login(app, credentials(seller))

			await http().post('/auth/logout').set('Cookie', session.cookies).expect(200)

			await me(other).expect(200)
		})

		it('logout-all ends every session of the account, this one included', async () => {
			const other = await login(app, credentials(seller))

			await mutate(session, 'post', '/auth/logout-all').expect(200)

			expect((await me(other).expect(401)).body.code).toMatch(/SESSION_(REVOKED|EXPIRED)/)
			expect((await refresh(other).expect(401)).body.code).toBe('SESSION_REVOKED')
			await me(session).expect(401)
			// A new login works and is not affected by the old version.
			await me(await login(app, credentials(seller))).expect(200)
		})

		it('logout-all is a protected mutation: it needs the CSRF token', async () => {
			await http().post('/auth/logout-all').set('Cookie', session.cookies).expect(403)
			await http().post('/auth/logout-all').expect(401)
		})
	})

	describe('account state applies on the next request, with no new login', () => {
		let sellerAccount: { id: string }
		let sellerSession: BrowserSession
		let adminSession: BrowserSession

		const reports = (session: BrowserSession) =>
			http().get('/reports?period=month').set('Cookie', session.cookies)

		beforeEach(async () => {
			sellerAccount = await register(seller, { plan_type: 'free' })
			await register(admin, { role: 'admin' })
			sellerSession = await login(app, credentials(seller))
			adminSession = await login(app, credentials(admin))
			// Warm the cached account copy, so a stale read would be caught below.
			await reports(sellerSession).expect(403)
		})

		it('a plan upgraded by the subscription writer (webhook path) unlocks Pro at once', async () => {
			const subscriptions = module.get<SubscriptionRepository>(SUBSCRIPTION_REPOSITORY)

			await subscriptions.updateAccountPlan(sellerAccount.id, 'pro')

			await reports(sellerSession).expect(200)
		})

		it('a plan downgraded by the subscription writer locks Pro at once', async () => {
			const subscriptions = module.get<SubscriptionRepository>(SUBSCRIPTION_REPOSITORY)
			await subscriptions.updateAccountPlan(sellerAccount.id, 'pro')
			await reports(sellerSession).expect(200)

			await subscriptions.updateAccountPlan(sellerAccount.id, 'free')

			await reports(sellerSession).expect(403)
		})

		it('a plan changed by an admin applies on the seller’s next request', async () => {
			await mutate(adminSession, 'patch', `/admin/accounts/${sellerAccount.id}/plan`)
				.send({ plan: 'pro' })
				.expect(200)

			await reports(sellerSession).expect(200)
		})

		it('a demoted admin loses the admin bypass immediately and stays signed in', async () => {
			// Promote the seller, let them act as an admin (free plan, yet reports open)...
			await mutate(adminSession, 'patch', `/admin/accounts/${sellerAccount.id}`)
				.send({ role: 'admin' })
				.expect(200)
			await reports(sellerSession).expect(200)
			await http().get('/admin/stats').set('Cookie', sellerSession.cookies).expect(200)

			// ...then demote them.
			await mutate(adminSession, 'patch', `/admin/accounts/${sellerAccount.id}`)
				.send({ role: 'seller' })
				.expect(200)

			await reports(sellerSession).expect(403)
			await http().get('/admin/stats').set('Cookie', sellerSession.cookies).expect(403)
			await me(sellerSession).expect(200)
		})

		it('a suspended account is signed out on its next request and cannot renew', async () => {
			await mutate(adminSession, 'post', `/admin/accounts/${sellerAccount.id}/suspend`)
				.send({ reason: 'e2e' })
				.expect(201)

			expect((await me(sellerSession).expect(401)).body.code).toBe('ACCOUNT_INACTIVE')
			const renewal = await refresh(sellerSession).expect(401)
			expect(renewal.body.code).toBe('ACCOUNT_INACTIVE')
			await http().post('/auth/login').send(credentials(seller)).expect(401)
		})

		it('reactivating does not revive the sessions that existed before the suspension', async () => {
			await mutate(adminSession, 'post', `/admin/accounts/${sellerAccount.id}/suspend`)
				.send({ reason: 'e2e' })
				.expect(201)
			await mutate(adminSession, 'patch', `/admin/accounts/${sellerAccount.id}`)
				.send({ is_active: true })
				.expect(200)

			expect((await me(sellerSession).expect(401)).body.code).toMatch(/SESSION_(REVOKED|EXPIRED)/)
			await me(await login(app, credentials(seller))).expect(200)
		})

		it('an account deleted by an admin is signed out', async () => {
			await mutate(adminSession, 'delete', `/admin/accounts/${sellerAccount.id}`).expect(204)

			expect((await me(sellerSession).expect(401)).body.code).toBe('SESSION_REVOKED')
			expect((await refresh(sellerSession).expect(401)).body.code).toBe('SESSION_REVOKED')
		})
	})

	describe('password changes end sessions', () => {
		let here: BrowserSession
		let elsewhere: BrowserSession

		beforeEach(async () => {
			await register(seller)
			here = await login(app, credentials(seller))
			elsewhere = await login(app, credentials(seller))
			await me(elsewhere).expect(200)
		})

		it('changing the password keeps this device signed in and signs out the others', async () => {
			const res = await mutate(here, 'post', '/auth/change-password')
				.send({ currentPassword: seller.password, newPassword: 'NewPassword456' })
				.expect(200)

			expect(res.body).toEqual({ message: 'Senha alterada com sucesso' })
			const renewed = mergeCookies(here, res.headers['set-cookie'])
			expect(renewed.sid).toBe(here.sid)
			await me(renewed).expect(200)
			await refresh(renewed).expect(200)

			expect((await me(elsewhere).expect(401)).body.code).toBe('SESSION_REVOKED')
			expect((await refresh(elsewhere).expect(401)).body.code).toBe('SESSION_REVOKED')
			// The cookies this device held before the change are dead too.
			expect((await me(here).expect(401)).body.code).toBe('SESSION_REVOKED')
		})

		it('a wrong current password changes nothing', async () => {
			await mutate(here, 'post', '/auth/change-password')
				.send({ currentPassword: 'not-the-password', newPassword: 'NewPassword456' })
				.expect(401)

			await me(here).expect(200)
			await me(elsewhere).expect(200)
		})

		it('resetting the password by e-mail signs out every device', async () => {
			const account = await prisma.account.findUniqueOrThrow({ where: { email: seller.email } })
			const token = randomBytes(32).toString('hex')
			await prisma.password_reset_token.create({
				data: {
					account_id: account.id,
					token: createHash('sha256').update(token).digest('hex'),
					expires_at: new Date(Date.now() + 3600_000),
				},
			})

			await http()
				.post('/auth/reset-password')
				.send({ token, password: 'ResetPassword789' })
				.expect(200)

			expect((await me(here).expect(401)).body.code).toBe('SESSION_REVOKED')
			expect((await refresh(elsewhere).expect(401)).body.code).toBe('SESSION_REVOKED')
			await login(app, { email: seller.email, password: 'ResetPassword789' })
		})

		it('anonymizing the account (LGPD) signs out every device', async () => {
			const res = await mutate(here, 'post', '/auth/data-deletion')
				.send({ password: seller.password, confirmation: 'DELETAR MINHA CONTA' })
				.expect(200)

			expect(parseSetCookies(res.headers['set-cookie']).access_token.value).toBe('')
			await me(here).expect(401)
			await me(elsewhere).expect(401)
			expect((await refresh(elsewhere).expect(401)).body.code).toBe('SESSION_REVOKED')
		})
	})

	describe('error shape', () => {
		it('a protected route without a session answers 401 SESSION_EXPIRED', async () => {
			const res = await http().get('/products').expect(401)

			expect(res.body).toMatchObject({ statusCode: 401, code: 'SESSION_EXPIRED' })
		})

		it('a forged or malformed token answers 401 SESSION_EXPIRED', async () => {
			const res = await http().get('/products').set('Authorization', 'Bearer not-a-jwt').expect(401)

			expect(res.body.code).toBe('SESSION_EXPIRED')
		})
	})
})
