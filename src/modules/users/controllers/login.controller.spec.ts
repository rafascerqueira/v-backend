/**
 * LoginController unit tests
 * Covers: POST /auth/login — @Public, validates credentials, handles 2FA, starts a
 *         session (cookies only, never tokens in the body), "keep me signed in".
 * Guards mocked: JwtAuthGuard, OriginGuard
 */

import { UnauthorizedException } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard'
import { OriginGuard } from '@/modules/auth/guards/origin.guard'
import { SessionService } from '@/modules/auth/services/session.service'
import { TwoFactorService } from '@/modules/auth/services/two-factor.service'
import { loginSchema } from '../dto/login.dto'
import { AccountService } from '../services/account.service'
import { LoginController } from './login.controller'

const accountServiceMock = {
	findByEmail: jest.fn(),
	verifyPassword: jest.fn(),
	updateLastLogin: jest.fn(),
}

const sessionServiceMock = {
	create: jest.fn(),
}

const twoFactorServiceMock = {
	verifyToken: jest.fn(),
}

function makeResponse() {
	return { setCookie: jest.fn() }
}

const request = { cookies: {} }

const baseAccount = {
	id: 'user-uuid-1',
	email: 'user@example.com',
	password: 'hashed',
	salt: 'salt',
	role: 'seller',
	plan_type: 'free',
	session_version: 4,
	two_factor_enabled: false,
}

const session = {
	accessToken: 'access',
	refreshToken: 'refresh',
	expiresIn: 900,
	persistent: true,
	sessionTtl: 2592000,
}

const credentials = { email: 'user@example.com', password: 'Password123', remember: true }

describe('LoginController', () => {
	let controller: LoginController

	beforeEach(async () => {
		const module = await Test.createTestingModule({
			controllers: [LoginController],
			providers: [
				{ provide: AccountService, useValue: accountServiceMock },
				{ provide: SessionService, useValue: sessionServiceMock },
				{ provide: TwoFactorService, useValue: twoFactorServiceMock },
			],
		})
			.overrideGuard(JwtAuthGuard)
			.useValue({ canActivate: () => true })
			.overrideGuard(OriginGuard)
			.useValue({ canActivate: () => true })
			.compile()

		controller = module.get(LoginController)
		jest.clearAllMocks()
	})

	describe('loginSchema', () => {
		it('defaults "remember" to true', () => {
			expect(loginSchema.parse({ email: 'user@example.com', password: 'Password123' })).toEqual({
				email: 'user@example.com',
				password: 'Password123',
				remember: true,
			})
		})

		it('keeps an explicit remember=false', () => {
			expect(loginSchema.parse({ ...credentials, remember: false }).remember).toBe(false)
		})

		it('rejects a non-boolean "remember"', () => {
			expect(loginSchema.safeParse({ ...credentials, remember: 'yes' }).success).toBe(false)
		})
	})

	describe('handle', () => {
		it('starts a session, sets the cookies and returns only expiresIn', async () => {
			accountServiceMock.findByEmail.mockResolvedValueOnce(baseAccount)
			accountServiceMock.verifyPassword.mockResolvedValueOnce(true)
			accountServiceMock.updateLastLogin.mockResolvedValueOnce(undefined)
			sessionServiceMock.create.mockResolvedValueOnce(session)

			const res = makeResponse()
			const result = await controller.handle(credentials, request as any, res as any)

			expect(accountServiceMock.findByEmail).toHaveBeenCalledWith('user@example.com')
			expect(accountServiceMock.verifyPassword).toHaveBeenCalledWith(
				'Password123',
				'hashed',
				'salt',
			)
			expect(accountServiceMock.updateLastLogin).toHaveBeenCalledWith('user-uuid-1')
			expect(sessionServiceMock.create).toHaveBeenCalledWith(baseAccount, { persistent: true })
			// access + refresh + csrf + session hint
			expect(res.setCookie.mock.calls.map(([name]) => name)).toEqual([
				'access_token',
				'refresh_token',
				'csrf_token',
				'vd_session',
			])
			// The tokens travel in HttpOnly cookies only.
			expect(result).toEqual({ expiresIn: 900 })
			expect(JSON.stringify(result)).not.toContain('access')
		})

		it('starts a browser session when "remember" is false', async () => {
			accountServiceMock.findByEmail.mockResolvedValueOnce(baseAccount)
			accountServiceMock.verifyPassword.mockResolvedValueOnce(true)
			sessionServiceMock.create.mockResolvedValueOnce({ ...session, persistent: false })

			const res = makeResponse()
			await controller.handle({ ...credentials, remember: false }, request as any, res as any)

			expect(sessionServiceMock.create).toHaveBeenCalledWith(baseAccount, { persistent: false })
			for (const [, , options] of res.setCookie.mock.calls) {
				expect(options).not.toHaveProperty('maxAge')
			}
		})

		it('should throw UnauthorizedException when email not found', async () => {
			accountServiceMock.findByEmail.mockResolvedValueOnce(null)

			const res = makeResponse()
			await expect(
				controller.handle(
					{ ...credentials, email: 'nobody@example.com' },
					request as any,
					res as any,
				),
			).rejects.toThrow(UnauthorizedException)
			expect(sessionServiceMock.create).not.toHaveBeenCalled()
		})

		it('should throw UnauthorizedException when password is wrong', async () => {
			accountServiceMock.findByEmail.mockResolvedValueOnce(baseAccount)
			accountServiceMock.verifyPassword.mockResolvedValueOnce(false)

			const res = makeResponse()
			await expect(
				controller.handle({ ...credentials, password: 'wrongpass' }, request as any, res as any),
			).rejects.toThrow(UnauthorizedException)
			expect(sessionServiceMock.create).not.toHaveBeenCalled()
			expect(res.setCookie).not.toHaveBeenCalled()
		})

		it('refuses a deactivated account without starting a session', async () => {
			accountServiceMock.findByEmail.mockResolvedValueOnce({ ...baseAccount, is_active: false })
			accountServiceMock.verifyPassword.mockResolvedValueOnce(true)

			const res = makeResponse()
			await expect(controller.handle(credentials, request as any, res as any)).rejects.toThrow(
				UnauthorizedException,
			)
			expect(sessionServiceMock.create).not.toHaveBeenCalled()
		})

		it('should return requiresTwoFactor when 2FA is enabled and no token provided', async () => {
			accountServiceMock.findByEmail.mockResolvedValueOnce({
				...baseAccount,
				two_factor_enabled: true,
			})
			accountServiceMock.verifyPassword.mockResolvedValueOnce(true)

			const res = makeResponse()
			const result = await controller.handle(credentials, request as any, res as any)

			expect(result).toEqual(expect.objectContaining({ requiresTwoFactor: true }))
			expect(sessionServiceMock.create).not.toHaveBeenCalled()
			expect(res.setCookie).not.toHaveBeenCalled()
		})

		it('should complete login when 2FA is enabled and valid token provided', async () => {
			accountServiceMock.findByEmail.mockResolvedValueOnce({
				...baseAccount,
				two_factor_enabled: true,
			})
			accountServiceMock.verifyPassword.mockResolvedValueOnce(true)
			twoFactorServiceMock.verifyToken.mockResolvedValueOnce(true)
			accountServiceMock.updateLastLogin.mockResolvedValueOnce(undefined)
			sessionServiceMock.create.mockResolvedValueOnce(session)

			const res = makeResponse()
			const result = await controller.handle(
				{ ...credentials, twoFactorToken: '123456' },
				request as any,
				res as any,
			)

			expect(twoFactorServiceMock.verifyToken).toHaveBeenCalledWith('user-uuid-1', '123456')
			expect(result).toEqual({ expiresIn: 900 })
		})

		it('should throw UnauthorizedException when 2FA token is invalid', async () => {
			accountServiceMock.findByEmail.mockResolvedValueOnce({
				...baseAccount,
				two_factor_enabled: true,
			})
			accountServiceMock.verifyPassword.mockResolvedValueOnce(true)
			twoFactorServiceMock.verifyToken.mockResolvedValueOnce(false)

			const res = makeResponse()
			await expect(
				controller.handle({ ...credentials, twoFactorToken: '000000' }, request as any, res as any),
			).rejects.toThrow(UnauthorizedException)
			expect(sessionServiceMock.create).not.toHaveBeenCalled()
		})
	})
})
