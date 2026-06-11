/**
 * RefreshTokenController unit tests
 * Covers: POST /auth/refresh — @Public, refreshes tokens via body or cookie
 */

import { UnauthorizedException } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard'
import { TokenService } from '../services/token.service'
import { TokenBlacklistService } from '../services/token-blacklist.service'
import { RefreshTokenController } from './refresh-token.controller'

const tokenServiceMock = {
	refreshTokens: jest.fn(),
}

const tokenBlacklistServiceMock = {
	isBlacklisted: jest.fn(),
}

function makeResponse() {
	return { setCookie: jest.fn() }
}

function makeRequest(cookies: Record<string, string> = {}) {
	return { cookies }
}

describe('RefreshTokenController', () => {
	let controller: RefreshTokenController

	beforeEach(async () => {
		const module = await Test.createTestingModule({
			controllers: [RefreshTokenController],
			providers: [
				{ provide: TokenService, useValue: tokenServiceMock },
				{ provide: TokenBlacklistService, useValue: tokenBlacklistServiceMock },
			],
		})
			.overrideGuard(JwtAuthGuard)
			.useValue({ canActivate: () => true })
			.compile()

		controller = module.get(RefreshTokenController)
		jest.clearAllMocks()
	})

	describe('handle', () => {
		const tokens = { accessToken: 'new-access', refreshToken: 'new-refresh', expiresIn: 900 }

		it('should refresh tokens when refreshToken provided in body', async () => {
			tokenServiceMock.refreshTokens.mockResolvedValueOnce(tokens)
			const res = makeResponse()
			const req = makeRequest()

			const result = await controller.handle(
				{ refreshToken: 'body-refresh-token' },
				req as any,
				res as any,
			)

			expect(tokenServiceMock.refreshTokens).toHaveBeenCalledWith(
				'body-refresh-token',
				tokenBlacklistServiceMock,
			)
			// access + refresh + csrf
			expect(res.setCookie).toHaveBeenCalledTimes(3)
			// CSRF cookie lifetime tracks the refresh token (7d), not the access token,
			// so it never expires mid-session and forces an empty-header 403.
			expect(res.setCookie).toHaveBeenCalledWith(
				'csrf_token',
				expect.any(String),
				expect.objectContaining({ maxAge: 7 * 24 * 60 * 60 }),
			)
			expect(result).toEqual(tokens)
		})

		it('should refresh tokens when refreshToken provided via cookie', async () => {
			tokenServiceMock.refreshTokens.mockResolvedValueOnce(tokens)
			const res = makeResponse()
			const req = makeRequest({ refresh_token: 'cookie-refresh-token' })

			await controller.handle({}, req as any, res as any)

			expect(tokenServiceMock.refreshTokens).toHaveBeenCalledWith(
				'cookie-refresh-token',
				tokenBlacklistServiceMock,
			)
		})

		it('should prefer body token over cookie token', async () => {
			tokenServiceMock.refreshTokens.mockResolvedValueOnce(tokens)
			const res = makeResponse()
			const req = makeRequest({ refresh_token: 'cookie-token' })

			await controller.handle({ refreshToken: 'body-token' }, req as any, res as any)

			expect(tokenServiceMock.refreshTokens).toHaveBeenCalledWith(
				'body-token',
				tokenBlacklistServiceMock,
			)
		})

		it('should throw UnauthorizedException when no refresh token provided', async () => {
			const res = makeResponse()
			const req = makeRequest()

			await expect(controller.handle({}, req as any, res as any)).rejects.toThrow(
				UnauthorizedException,
			)
		})

		it('should throw UnauthorizedException when token service throws', async () => {
			tokenServiceMock.refreshTokens.mockRejectedValueOnce(new Error('expired'))
			const res = makeResponse()
			const req = makeRequest()

			await expect(
				controller.handle({ refreshToken: 'bad-token' }, req as any, res as any),
			).rejects.toThrow(UnauthorizedException)
		})
	})
})
