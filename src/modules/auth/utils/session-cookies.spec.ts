import type { IssuedSession } from '../session/session.types'
import { clearSessionCookies, readSessionCookies, setSessionCookies } from './session-cookies'

function makeReply() {
	return { setCookie: jest.fn(), clearCookie: jest.fn() }
}

const cookieCall = (reply: ReturnType<typeof makeReply>, name: string) =>
	reply.setCookie.mock.calls.find(([cookie]) => cookie === name)

const session: IssuedSession = {
	accessToken: 'access.jwt',
	refreshToken: 'refresh.jwt',
	expiresIn: 900,
	persistent: true,
	sessionTtl: 2592000,
}

describe('session cookies', () => {
	const env = { ...process.env }

	afterEach(() => {
		process.env = { ...env }
	})

	describe('setSessionCookies', () => {
		it('writes the four cookies of a "keep me signed in" session', () => {
			const reply = makeReply()

			setSessionCookies({ cookies: {} } as any, reply as any, session)

			expect(cookieCall(reply, 'access_token')).toEqual([
				'access_token',
				'access.jwt',
				expect.objectContaining({ httpOnly: true, sameSite: 'lax', path: '/', maxAge: 900 }),
			])
			expect(cookieCall(reply, 'refresh_token')).toEqual([
				'refresh_token',
				'refresh.jwt',
				expect.objectContaining({
					httpOnly: true,
					sameSite: 'lax',
					path: '/auth',
					maxAge: 2592000,
				}),
			])
			expect(cookieCall(reply, 'csrf_token')).toEqual([
				'csrf_token',
				expect.stringMatching(/^[0-9a-f]{64}$/),
				expect.objectContaining({ httpOnly: false, path: '/', maxAge: 2592000 }),
			])
			expect(cookieCall(reply, 'vd_session')).toEqual([
				'vd_session',
				'1',
				expect.objectContaining({ httpOnly: false, path: '/', maxAge: 2592000 }),
			])
			expect(reply.setCookie).toHaveBeenCalledTimes(4)
		})

		it('uses browser-session cookies (no Max-Age) without "keep me signed in"', () => {
			const reply = makeReply()

			setSessionCookies({ cookies: {} } as any, reply as any, {
				...session,
				persistent: false,
				sessionTtl: 43200,
			})

			for (const [, , options] of reply.setCookie.mock.calls) {
				expect(options).not.toHaveProperty('maxAge')
			}
			expect(reply.setCookie).toHaveBeenCalledTimes(4)
		})

		it('marks the cookies Secure and scopes them to COOKIE_DOMAIN in production', () => {
			process.env.NODE_ENV = 'production'
			process.env.COOKIE_DOMAIN = '.vendinhas.app'
			const reply = makeReply()

			setSessionCookies({ cookies: {} } as any, reply as any, session)

			for (const [, , options] of reply.setCookie.mock.calls) {
				expect(options).toMatchObject({ secure: true, domain: '.vendinhas.app' })
			}
		})

		it('in the grace window writes only the access cookie and leaves the CSRF token alone', () => {
			const reply = makeReply()
			const request = { cookies: { csrf_token: 'already-there' } }

			setSessionCookies(request as any, reply as any, { ...session, refreshToken: undefined })

			expect(reply.setCookie).toHaveBeenCalledTimes(1)
			expect(reply.setCookie).toHaveBeenCalledWith('access_token', 'access.jwt', expect.any(Object))
		})

		it('in the grace window seeds a CSRF cookie only when the request has none', () => {
			const reply = makeReply()

			setSessionCookies({ cookies: {} } as any, reply as any, {
				...session,
				refreshToken: undefined,
			})

			expect(reply.setCookie.mock.calls.map(([name]) => name)).toEqual([
				'access_token',
				'csrf_token',
			])
		})
	})

	describe('clearSessionCookies', () => {
		it('clears every session cookie, including a refresh cookie scoped to the old path', () => {
			const reply = makeReply()

			clearSessionCookies(reply as any)

			const cleared = reply.clearCookie.mock.calls.map(([name, options]) => [name, options.path])
			expect(cleared).toEqual([
				['access_token', '/'],
				['refresh_token', '/auth'],
				['refresh_token', '/'],
				['csrf_token', '/'],
				['vd_session', '/'],
			])
		})
	})

	describe('readSessionCookies', () => {
		it('reads the tokens from the cookies only', () => {
			expect(
				readSessionCookies({ cookies: { access_token: 'a', refresh_token: 'r' } } as any),
			).toEqual({ accessToken: 'a', refreshToken: 'r' })
		})

		it('treats missing or empty cookies as absent', () => {
			expect(readSessionCookies({ cookies: { access_token: '' } } as any)).toEqual({
				accessToken: undefined,
				refreshToken: undefined,
			})
			expect(readSessionCookies({} as any)).toEqual({
				accessToken: undefined,
				refreshToken: undefined,
			})
		})
	})
})
