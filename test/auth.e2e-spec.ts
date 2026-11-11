import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import request from 'supertest'
import type { PrismaService } from '../src/shared/prisma/prisma.service'
import { createE2EApp } from './helpers/e2e'
import { cookieHeader, parseSetCookies } from './helpers/session'

describe('Auth (e2e)', () => {
	let app: NestFastifyApplication
	let prisma: PrismaService

	beforeEach(async () => {
		;({ app, prisma } = await createE2EApp({ realAuth: true }))
	})

	afterEach(async () => {
		await prisma.account.deleteMany()
		await app.close()
	})

	const validUser = {
		name: 'Test User',
		email: 'test@example.com',
		password: 'Password123',
	}

	describe('POST /auth/register', () => {
		it('should register a new user', async () => {
			const response = await request(app.getHttpServer())
				.post('/auth/register')
				.send(validUser)
				.expect(201)

			expect(response.body).toHaveProperty('message')
		})

		it('should reject duplicate email', async () => {
			await request(app.getHttpServer()).post('/auth/register').send(validUser).expect(201)

			await request(app.getHttpServer()).post('/auth/register').send(validUser).expect(400)
		})

		it('should reject invalid email', async () => {
			await request(app.getHttpServer())
				.post('/auth/register')
				.send({ ...validUser, email: 'invalid' })
				.expect(400)
		})

		it('should reject weak password', async () => {
			await request(app.getHttpServer())
				.post('/auth/register')
				.send({ ...validUser, password: '123' })
				.expect(400)
		})
	})

	describe('POST /auth/login', () => {
		beforeEach(async () => {
			await request(app.getHttpServer()).post('/auth/register').send(validUser)
		})

		it('should login, set the session cookies and keep the tokens out of the body', async () => {
			const response = await request(app.getHttpServer())
				.post('/auth/login')
				.send({ email: validUser.email, password: validUser.password })
				.expect(200)

			expect(response.body).toEqual({ expiresIn: expect.any(Number) })
			expect(response.body).not.toHaveProperty('accessToken')
			expect(response.body).not.toHaveProperty('refreshToken')
			const cookies = parseSetCookies(response.headers['set-cookie'])
			expect(cookies.access_token?.value).toBeTruthy()
			expect(cookies.refresh_token?.value).toBeTruthy()
		})

		it('should reject wrong password', async () => {
			await request(app.getHttpServer())
				.post('/auth/login')
				.send({ email: validUser.email, password: 'WrongPassword123' })
				.expect(401)
		})

		it('should reject non-existent user', async () => {
			await request(app.getHttpServer())
				.post('/auth/login')
				.send({ email: 'nonexistent@example.com', password: validUser.password })
				.expect(401)
		})
	})

	describe('POST /auth/refresh', () => {
		let sessionCookies: string

		beforeEach(async () => {
			await request(app.getHttpServer()).post('/auth/register').send(validUser)

			const loginResponse = await request(app.getHttpServer())
				.post('/auth/login')
				.send({ email: validUser.email, password: validUser.password })

			sessionCookies = cookieHeader(parseSetCookies(loginResponse.headers['set-cookie']))
		})

		it('should refresh the session from the cookie', async () => {
			const response = await request(app.getHttpServer())
				.post('/auth/refresh')
				.set('Cookie', sessionCookies)
				.send({})
				.expect(200)

			expect(response.body).toEqual({ expiresIn: expect.any(Number) })
			const cookies = parseSetCookies(response.headers['set-cookie'])
			expect(cookies.access_token?.value).toBeTruthy()
			expect(cookies.refresh_token?.value).toBeTruthy()
		})

		it('should reject an invalid refresh token', async () => {
			await request(app.getHttpServer())
				.post('/auth/refresh')
				.set('Cookie', 'refresh_token=invalid-token')
				.send({})
				.expect(401)
		})

		it('should reject a refresh without the cookie', async () => {
			await request(app.getHttpServer()).post('/auth/refresh').send({}).expect(401)
		})
	})

	describe('Protected routes', () => {
		let accessToken: string

		beforeEach(async () => {
			await request(app.getHttpServer()).post('/auth/register').send(validUser)

			const loginResponse = await request(app.getHttpServer())
				.post('/auth/login')
				.send({ email: validUser.email, password: validUser.password })

			// API clients may present the access token as a Bearer credential; it is only
			// ever handed out in the HttpOnly cookie.
			accessToken = parseSetCookies(loginResponse.headers['set-cookie']).access_token.value
		})

		it('should access protected route with valid token', async () => {
			await request(app.getHttpServer())
				.get('/products')
				.set('Authorization', `Bearer ${accessToken}`)
				.expect((res) => {
					expect([200, 404]).toContain(res.status)
				})
		})

		it('should reject access without token', async () => {
			await request(app.getHttpServer()).get('/products').expect(401)
		})

		it('should reject access with invalid token', async () => {
			await request(app.getHttpServer())
				.get('/products')
				.set('Authorization', 'Bearer invalid-token')
				.expect(401)
		})
	})

	// --- Cookie + CSRF flow ----------------------------------------------------
	// Browsers use the cookie path, which is where production has been failing (403 on
	// mutations). These tests assert the *actual* mechanism the SPA depends on: HttpOnly
	// session cookies, a JS-readable CSRF cookie, and double-submit validation.

	describe('Cookie-based auth', () => {
		beforeEach(async () => {
			await request(app.getHttpServer()).post('/auth/register').send(validUser)
		})

		it('login sets access_token, refresh_token and csrf_token cookies', async () => {
			const res = await request(app.getHttpServer())
				.post('/auth/login')
				.send({ email: validUser.email, password: validUser.password })
				.expect(200)

			const cookies = parseSetCookies(res.headers['set-cookie'])
			expect(cookies.access_token?.value).toBeTruthy()
			expect(cookies.refresh_token?.value).toBeTruthy()
			expect(cookies.csrf_token?.value).toBeTruthy()
		})

		it('session cookies are HttpOnly but the CSRF cookie is JS-readable', async () => {
			const res = await request(app.getHttpServer())
				.post('/auth/login')
				.send({ email: validUser.email, password: validUser.password })
				.expect(200)

			const cookies = parseSetCookies(res.headers['set-cookie'])
			// access/refresh must NOT be reachable by JS (XSS hardening)
			expect(cookies.access_token?.attrs).toContain('httponly')
			expect(cookies.refresh_token?.attrs).toContain('httponly')
			// csrf MUST be readable so the SPA can echo it into X-CSRF-Token
			expect(cookies.csrf_token?.attrs).not.toContain('httponly')
		})

		it('authenticates a protected GET using only the session cookie (no Bearer)', async () => {
			const login = await request(app.getHttpServer())
				.post('/auth/login')
				.send({ email: validUser.email, password: validUser.password })
				.expect(200)

			const setCookie = login.headers['set-cookie']
			await request(app.getHttpServer())
				.get('/auth/me')
				.set('Cookie', setCookie)
				.expect(200)
				.expect((r) => expect(r.body.email).toBe(validUser.email))
		})

		it('rejects a protected GET when no cookie and no Bearer are sent', async () => {
			await request(app.getHttpServer()).get('/auth/me').expect(401)
		})
	})

	describe('CSRF double-submit on cookie-authenticated mutations', () => {
		let sessionCookies: string[]
		let csrfToken: string

		beforeEach(async () => {
			await request(app.getHttpServer()).post('/auth/register').send(validUser)
			const login = await request(app.getHttpServer())
				.post('/auth/login')
				.send({ email: validUser.email, password: validUser.password })
				.expect(200)

			sessionCookies = login.headers['set-cookie'] as unknown as string[]
			csrfToken = parseSetCookies(login.headers['set-cookie']).csrf_token.value
		})

		// PATCH /auth/profile is a cookie-auth mutation — the canonical state-changing
		// request the SPA performs and exactly the kind that 403'd in production.
		const mutate = () =>
			request(app.getHttpServer()).patch('/auth/profile').set('Cookie', sessionCookies)

		it('rejects a cookie-auth mutation with NO X-CSRF-Token header (403)', async () => {
			await mutate().send({ name: 'Renamed' }).expect(403)
		})

		it('rejects a cookie-auth mutation when the header does NOT match the cookie (403)', async () => {
			await mutate().set('X-CSRF-Token', 'f'.repeat(64)).send({ name: 'Renamed' }).expect(403)
		})

		it('accepts a cookie-auth mutation when X-CSRF-Token matches the csrf cookie', async () => {
			await mutate()
				.set('X-CSRF-Token', csrfToken)
				.send({ name: 'Renamed' })
				.expect((r) => {
					// Must NOT be the CSRF rejection. 2xx on success; never 403.
					expect(r.status).not.toBe(403)
					expect([200, 201, 204]).toContain(r.status)
				})
		})

		it('does NOT require CSRF for Bearer-authenticated mutations (non-ambient credential)', async () => {
			const accessToken = parseSetCookies(sessionCookies).access_token.value

			await request(app.getHttpServer())
				.patch('/auth/profile')
				.set('Authorization', `Bearer ${accessToken}`)
				.send({ name: 'BearerRenamed' })
				.expect((r) => expect(r.status).not.toBe(403))
		})
	})

	describe('Refresh rotates the session and CSRF cookies', () => {
		it('refresh via cookie issues new access_token, refresh_token and csrf_token', async () => {
			await request(app.getHttpServer()).post('/auth/register').send(validUser)
			const login = await request(app.getHttpServer())
				.post('/auth/login')
				.send({ email: validUser.email, password: validUser.password })
				.expect(200)

			const loginCookies = parseSetCookies(login.headers['set-cookie'])

			const res = await request(app.getHttpServer())
				.post('/auth/refresh')
				.set('Cookie', login.headers['set-cookie'])
				// The SPA sends an empty body; the refresh token rides in the HttpOnly cookie.
				.send({})
				.expect(200)

			const refreshed = parseSetCookies(res.headers['set-cookie'])
			expect(refreshed.access_token?.value).toBeTruthy()
			expect(refreshed.refresh_token?.value).toBeTruthy()
			expect(refreshed.csrf_token?.value).toBeTruthy()
			// The CSRF token must actually rotate at this session boundary.
			expect(refreshed.csrf_token.value).not.toBe(loginCookies.csrf_token.value)
		})
	})
})
