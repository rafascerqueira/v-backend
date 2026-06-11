/**
 * LogoutController unit tests
 * Covers: POST /auth/logout — blacklists access & refresh tokens, clears cookies
 * Guards mocked: JwtAuthGuard (global default)
 */

import { Test } from '@nestjs/testing'
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard'
import { TokenService } from '../services/token.service'
import { TokenBlacklistService } from '../services/token-blacklist.service'
import { LogoutController } from './logout.controller'

const tokenServiceMock = {
	verifyAccessToken: jest.fn(),
	verifyRefreshToken: jest.fn(),
}

const tokenBlacklistServiceMock = {
	addToBlacklist: jest.fn(),
}

function makeResponse() {
	return {
		clearCookie: jest.fn(),
	}
}

function makeRequest(cookies: Record<string, string> = {}) {
	return { cookies }
}

describe('LogoutController', () => {
	let controller: LogoutController

	beforeEach(async () => {
		const module = await Test.createTestingModule({
			controllers: [LogoutController],
			providers: [
				{ provide: TokenService, useValue: tokenServiceMock },
				{ provide: TokenBlacklistService, useValue: tokenBlacklistServiceMock },
			],
		})
			.overrideGuard(JwtAuthGuard)
			.useValue({ canActivate: () => true })
			.compile()

		controller = module.get(LogoutController)
		jest.clearAllMocks()
	})

	describe('handle', () => {
		it('should blacklist access token from Authorization header and return success', async () => {
			const futureExp = Math.floor(Date.now() / 1000) + 3600
			tokenServiceMock.verifyAccessToken.mockResolvedValueOnce({ exp: futureExp })
			tokenBlacklistServiceMock.addToBlacklist.mockResolvedValueOnce(undefined)

			const req = makeRequest()
			const res = makeResponse()

			const result = await controller.handle('Bearer valid-token', req as any, res as any)

			expect(tokenServiceMock.verifyAccessToken).toHaveBeenCalledWith('valid-token')
			expect(tokenBlacklistServiceMock.addToBlacklist).toHaveBeenCalledWith(
				'valid-token',
				expect.any(Number),
			)
			expect(res.clearCookie).toHaveBeenCalled()
			expect(result).toEqual({ message: 'Logout successful' })
		})

		it('should blacklist refresh token from cookie when present', async () => {
			const futureExp = Math.floor(Date.now() / 1000) + 86400
			tokenServiceMock.verifyAccessToken.mockRejectedValueOnce(new Error('expired'))
			tokenServiceMock.verifyRefreshToken.mockResolvedValueOnce({ exp: futureExp })
			tokenBlacklistServiceMock.addToBlacklist.mockResolvedValueOnce(undefined)

			const req = makeRequest({ refresh_token: 'cookie-refresh-token' })
			const res = makeResponse()

			const result = await controller.handle('', req as any, res as any)

			expect(tokenServiceMock.verifyRefreshToken).toHaveBeenCalledWith('cookie-refresh-token')
			expect(res.clearCookie).toHaveBeenCalled()
			expect(result).toEqual({ message: 'Logout successful' })
		})

		it('should still clear cookies even when tokens are invalid', async () => {
			tokenServiceMock.verifyAccessToken.mockRejectedValueOnce(new Error('invalid'))
			tokenServiceMock.verifyRefreshToken.mockRejectedValueOnce(new Error('invalid'))

			const req = makeRequest({ refresh_token: 'bad-token' })
			const res = makeResponse()

			const result = await controller.handle('Bearer bad-access-token', req as any, res as any)

			expect(tokenBlacklistServiceMock.addToBlacklist).not.toHaveBeenCalled()
			expect(res.clearCookie).toHaveBeenCalled()
			expect(result).toEqual({ message: 'Logout successful' })
		})

		it('should not blacklist when token exp is in the past', async () => {
			const pastExp = Math.floor(Date.now() / 1000) - 100
			tokenServiceMock.verifyAccessToken.mockResolvedValueOnce({ exp: pastExp })

			const req = makeRequest()
			const res = makeResponse()

			await controller.handle('Bearer expired-token', req as any, res as any)

			expect(tokenBlacklistServiceMock.addToBlacklist).not.toHaveBeenCalled()
		})

		it('should use access token from cookie when no Authorization header', async () => {
			const futureExp = Math.floor(Date.now() / 1000) + 3600
			tokenServiceMock.verifyAccessToken.mockResolvedValueOnce({ exp: futureExp })
			tokenBlacklistServiceMock.addToBlacklist.mockResolvedValueOnce(undefined)

			const req = makeRequest({ access_token: 'cookie-access-token' })
			const res = makeResponse()

			await controller.handle('', req as any, res as any)

			expect(tokenServiceMock.verifyAccessToken).toHaveBeenCalledWith('cookie-access-token')
		})
	})
})
