/**
 * LoginController unit tests
 * Covers: POST /auth/login — @Public, validates credentials, handles 2FA, sets cookies
 * Guards mocked: JwtAuthGuard
 */

import { UnauthorizedException } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard'
import { TokenService } from '@/modules/auth/services/token.service'
import { TwoFactorService } from '@/modules/auth/services/two-factor.service'
import { AccountService } from '../services/account.service'
import { LoginController } from './login.controller'

const accountServiceMock = {
	findByEmail: jest.fn(),
	verifyPassword: jest.fn(),
	updateLastLogin: jest.fn(),
}

const tokenServiceMock = {
	generateTokens: jest.fn(),
}

const twoFactorServiceMock = {
	verifyToken: jest.fn(),
}

function makeResponse() {
	return { setCookie: jest.fn() }
}

const baseAccount = {
	id: 'user-uuid-1',
	email: 'user@example.com',
	password: 'hashed',
	salt: 'salt',
	role: 'seller',
	plan_type: 'free',
	two_factor_enabled: false,
}

const tokens = { accessToken: 'access', refreshToken: 'refresh', expiresIn: 900 }

describe('LoginController', () => {
	let controller: LoginController

	beforeEach(async () => {
		const module = await Test.createTestingModule({
			controllers: [LoginController],
			providers: [
				{ provide: AccountService, useValue: accountServiceMock },
				{ provide: TokenService, useValue: tokenServiceMock },
				{ provide: TwoFactorService, useValue: twoFactorServiceMock },
			],
		})
			.overrideGuard(JwtAuthGuard)
			.useValue({ canActivate: () => true })
			.compile()

		controller = module.get(LoginController)
		jest.clearAllMocks()
	})

	describe('handle', () => {
		it('should return tokens and set cookies on valid credentials', async () => {
			accountServiceMock.findByEmail.mockResolvedValueOnce(baseAccount)
			accountServiceMock.verifyPassword.mockResolvedValueOnce(true)
			accountServiceMock.updateLastLogin.mockResolvedValueOnce(undefined)
			tokenServiceMock.generateTokens.mockResolvedValueOnce(tokens)

			const res = makeResponse()
			const result = await controller.handle(
				{ email: 'user@example.com', password: 'Password123' },
				res as any,
			)

			expect(accountServiceMock.findByEmail).toHaveBeenCalledWith('user@example.com')
			expect(accountServiceMock.verifyPassword).toHaveBeenCalledWith(
				'Password123',
				'hashed',
				'salt',
			)
			expect(accountServiceMock.updateLastLogin).toHaveBeenCalledWith('user-uuid-1')
			expect(tokenServiceMock.generateTokens).toHaveBeenCalledWith({
				sub: 'user-uuid-1',
				email: 'user@example.com',
				role: 'seller',
				plan_type: 'free',
			})
			// access + refresh + csrf
			expect(res.setCookie).toHaveBeenCalledTimes(3)
			expect(result).toEqual(tokens)
		})

		it('should throw UnauthorizedException when email not found', async () => {
			accountServiceMock.findByEmail.mockResolvedValueOnce(null)

			const res = makeResponse()
			await expect(
				controller.handle({ email: 'nobody@example.com', password: 'pass' }, res as any),
			).rejects.toThrow(UnauthorizedException)
		})

		it('should throw UnauthorizedException when password is wrong', async () => {
			accountServiceMock.findByEmail.mockResolvedValueOnce(baseAccount)
			accountServiceMock.verifyPassword.mockResolvedValueOnce(false)

			const res = makeResponse()
			await expect(
				controller.handle({ email: 'user@example.com', password: 'wrongpass' }, res as any),
			).rejects.toThrow(UnauthorizedException)
		})

		it('should return requiresTwoFactor when 2FA is enabled and no token provided', async () => {
			accountServiceMock.findByEmail.mockResolvedValueOnce({
				...baseAccount,
				two_factor_enabled: true,
			})
			accountServiceMock.verifyPassword.mockResolvedValueOnce(true)

			const res = makeResponse()
			const result = await controller.handle(
				{ email: 'user@example.com', password: 'Password123' },
				res as any,
			)

			expect(result).toEqual(expect.objectContaining({ requiresTwoFactor: true }))
		})

		it('should complete login when 2FA is enabled and valid token provided', async () => {
			accountServiceMock.findByEmail.mockResolvedValueOnce({
				...baseAccount,
				two_factor_enabled: true,
			})
			accountServiceMock.verifyPassword.mockResolvedValueOnce(true)
			twoFactorServiceMock.verifyToken.mockResolvedValueOnce(true)
			accountServiceMock.updateLastLogin.mockResolvedValueOnce(undefined)
			tokenServiceMock.generateTokens.mockResolvedValueOnce(tokens)

			const res = makeResponse()
			const result = await controller.handle(
				{ email: 'user@example.com', password: 'Password123', twoFactorToken: '123456' },
				res as any,
			)

			expect(twoFactorServiceMock.verifyToken).toHaveBeenCalledWith('user-uuid-1', '123456')
			expect(result).toEqual(tokens)
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
				controller.handle(
					{ email: 'user@example.com', password: 'Password123', twoFactorToken: '000000' },
					res as any,
				),
			).rejects.toThrow(UnauthorizedException)
		})
	})
})
