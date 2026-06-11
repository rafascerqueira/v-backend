/**
 * JwtAuthGuard unit tests.
 * Covers: @Public() bypass, missing token, blacklist revocation branch,
 *         invalid/expired token, and successful header- vs cookie-based auth.
 *
 * TokenService and TokenBlacklistService are mocked at the constructor level
 * (no real JwtService / Redis). Reflector is a plain jest mock.
 */
import { UnauthorizedException } from '@nestjs/common'
import type { Reflector } from '@nestjs/core'
import { AUTH_COOKIES } from '../constants/cookies'
import type { TokenService } from '../services/token.service'
import type { TokenBlacklistService } from '../services/token-blacklist.service'
import { JwtAuthGuard } from './jwt-auth.guard'

function makeContext(req: any): any {
	return {
		switchToHttp: () => ({ getRequest: () => req }),
		getHandler: () => null,
		getClass: () => null,
	}
}

describe('JwtAuthGuard', () => {
	let guard: JwtAuthGuard
	let tokenService: { verifyAccessToken: jest.Mock }
	let blacklist: { isBlacklisted: jest.Mock }
	let reflector: { getAllAndOverride: jest.Mock }

	beforeEach(() => {
		tokenService = { verifyAccessToken: jest.fn() }
		blacklist = { isBlacklisted: jest.fn().mockResolvedValue(false) }
		reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) }
		guard = new JwtAuthGuard(
			tokenService as unknown as TokenService,
			blacklist as unknown as TokenBlacklistService,
			reflector as unknown as Reflector,
		)
	})

	it('bypasses auth entirely for @Public() routes', async () => {
		reflector.getAllAndOverride.mockReturnValueOnce(true)
		const req = { headers: {}, cookies: {} }

		await expect(guard.canActivate(makeContext(req))).resolves.toBe(true)
		// Short-circuits before touching the token or the blacklist.
		expect(blacklist.isBlacklisted).not.toHaveBeenCalled()
		expect(tokenService.verifyAccessToken).not.toHaveBeenCalled()
	})

	it('rejects when no token is present in header or cookie', async () => {
		const req = { headers: {}, cookies: {} }

		await expect(guard.canActivate(makeContext(req))).rejects.toThrow(
			new UnauthorizedException('Token not provided'),
		)
		expect(blacklist.isBlacklisted).not.toHaveBeenCalled()
	})

	it('rejects a revoked (blacklisted) token before verifying it', async () => {
		blacklist.isBlacklisted.mockResolvedValueOnce(true)
		const req = { headers: { authorization: 'Bearer revoked-token' }, cookies: {} }

		await expect(guard.canActivate(makeContext(req))).rejects.toThrow(
			new UnauthorizedException('Token has been revoked'),
		)
		expect(blacklist.isBlacklisted).toHaveBeenCalledWith('revoked-token')
		// Verification must NOT run for a blacklisted token.
		expect(tokenService.verifyAccessToken).not.toHaveBeenCalled()
	})

	it('rejects an invalid/expired token (verifyAccessToken throws)', async () => {
		blacklist.isBlacklisted.mockResolvedValueOnce(false)
		tokenService.verifyAccessToken.mockRejectedValueOnce(new Error('jwt expired'))
		const req = { headers: { authorization: 'Bearer bad-token' }, cookies: {} }

		await expect(guard.canActivate(makeContext(req))).rejects.toThrow(
			new UnauthorizedException('Invalid or expired token'),
		)
		expect(req).not.toHaveProperty('user')
	})

	it('authenticates a valid Bearer token and attaches the payload to request.user', async () => {
		const payload = { sub: 'acc-1', email: 'a@b.com', role: 'seller', type: 'access' }
		blacklist.isBlacklisted.mockResolvedValueOnce(false)
		tokenService.verifyAccessToken.mockResolvedValueOnce(payload)
		const req: any = { headers: { authorization: 'Bearer good-token' }, cookies: {} }

		await expect(guard.canActivate(makeContext(req))).resolves.toBe(true)
		expect(blacklist.isBlacklisted).toHaveBeenCalledWith('good-token')
		expect(tokenService.verifyAccessToken).toHaveBeenCalledWith('good-token')
		expect(req.user).toEqual(payload)
	})

	it('falls back to the HttpOnly access_token cookie when there is no Bearer header', async () => {
		const payload = { sub: 'acc-2', type: 'access' }
		tokenService.verifyAccessToken.mockResolvedValueOnce(payload)
		const req: any = {
			headers: {},
			cookies: { [AUTH_COOKIES.ACCESS_TOKEN]: 'cookie-token' },
		}

		await expect(guard.canActivate(makeContext(req))).resolves.toBe(true)
		expect(tokenService.verifyAccessToken).toHaveBeenCalledWith('cookie-token')
		expect(req.user).toEqual(payload)
	})

	it('ignores a non-Bearer Authorization scheme and falls back to the cookie', async () => {
		const payload = { sub: 'acc-3', type: 'access' }
		tokenService.verifyAccessToken.mockResolvedValueOnce(payload)
		const req: any = {
			headers: { authorization: 'Basic dXNlcjpwYXNz' },
			cookies: { [AUTH_COOKIES.ACCESS_TOKEN]: 'cookie-token' },
		}

		await expect(guard.canActivate(makeContext(req))).resolves.toBe(true)
		expect(tokenService.verifyAccessToken).toHaveBeenCalledWith('cookie-token')
	})

	it('prefers the Bearer header over the cookie when both are present', async () => {
		const payload = { sub: 'acc-4', type: 'access' }
		tokenService.verifyAccessToken.mockResolvedValueOnce(payload)
		const req: any = {
			headers: { authorization: 'Bearer header-token' },
			cookies: { [AUTH_COOKIES.ACCESS_TOKEN]: 'cookie-token' },
		}

		await expect(guard.canActivate(makeContext(req))).resolves.toBe(true)
		expect(tokenService.verifyAccessToken).toHaveBeenCalledWith('header-token')
	})
})
