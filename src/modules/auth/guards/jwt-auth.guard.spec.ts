/**
 * JwtAuthGuard unit tests.
 * Covers: @Public() bypass, missing token, header- vs cookie-based token extraction,
 *         request.user populated from the session (account state, not token claims),
 *         and that session failures propagate untouched (401 with a code, 503).
 *
 * SessionService is mocked at the constructor level (no JwtService / Redis).
 */
import type { Reflector } from '@nestjs/core'
import { AUTH_COOKIES } from '../constants/cookies'
import type { SessionService } from '../services/session.service'
import {
	SESSION_ERROR_CODE,
	SessionException,
	SessionStoreUnavailableException,
} from '../session/session.errors'
import { JwtAuthGuard } from './jwt-auth.guard'

function makeContext(req: any): any {
	return {
		switchToHttp: () => ({ getRequest: () => req }),
		getHandler: () => null,
		getClass: () => null,
	}
}

const user = {
	sub: 'acc-1',
	email: 'a@b.com',
	role: 'seller' as const,
	plan_type: 'pro' as const,
	sid: 'sid-1',
}

describe('JwtAuthGuard', () => {
	let guard: JwtAuthGuard
	let sessionService: { authenticate: jest.Mock }
	let reflector: { getAllAndOverride: jest.Mock }

	beforeEach(() => {
		sessionService = { authenticate: jest.fn().mockResolvedValue(user) }
		reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) }
		guard = new JwtAuthGuard(
			sessionService as unknown as SessionService,
			reflector as unknown as Reflector,
		)
	})

	it('bypasses auth entirely for @Public() routes', async () => {
		reflector.getAllAndOverride.mockReturnValueOnce(true)
		const req: any = { headers: {}, cookies: {} }

		await expect(guard.canActivate(makeContext(req))).resolves.toBe(true)
		expect(sessionService.authenticate).not.toHaveBeenCalled()
		expect(req.user).toBeUndefined()
	})

	it('answers 401 SESSION_EXPIRED when no token is present in header or cookie', async () => {
		const req = { headers: {}, cookies: {} }

		const error = await guard.canActivate(makeContext(req)).catch((e) => e)

		expect(error).toBeInstanceOf(SessionException)
		expect(error.getStatus()).toBe(401)
		expect(error.getResponse()).toMatchObject({ code: SESSION_ERROR_CODE.EXPIRED })
		expect(sessionService.authenticate).not.toHaveBeenCalled()
	})

	it('authenticates from the Authorization header and sets request.user', async () => {
		const req: any = { headers: { authorization: 'Bearer header-token' }, cookies: {} }

		await expect(guard.canActivate(makeContext(req))).resolves.toBe(true)

		expect(sessionService.authenticate).toHaveBeenCalledWith('header-token')
		// The user is whatever the session resolved from the account, verbatim.
		expect(req.user).toBe(user)
	})

	it('falls back to the HttpOnly access cookie', async () => {
		const req: any = { headers: {}, cookies: { [AUTH_COOKIES.ACCESS_TOKEN]: 'cookie-token' } }

		await expect(guard.canActivate(makeContext(req))).resolves.toBe(true)

		expect(sessionService.authenticate).toHaveBeenCalledWith('cookie-token')
		expect(req.user).toBe(user)
	})

	it('prefers the Authorization header over the cookie', async () => {
		const req: any = {
			headers: { authorization: 'Bearer header-token' },
			cookies: { [AUTH_COOKIES.ACCESS_TOKEN]: 'cookie-token' },
		}

		await guard.canActivate(makeContext(req))

		expect(sessionService.authenticate).toHaveBeenCalledWith('header-token')
	})

	it('ignores a non-Bearer Authorization header and uses the cookie', async () => {
		const req: any = {
			headers: { authorization: 'Basic abc' },
			cookies: { [AUTH_COOKIES.ACCESS_TOKEN]: 'cookie-token' },
		}

		await guard.canActivate(makeContext(req))

		expect(sessionService.authenticate).toHaveBeenCalledWith('cookie-token')
	})

	it.each([
		SESSION_ERROR_CODE.EXPIRED,
		SESSION_ERROR_CODE.REVOKED,
		SESSION_ERROR_CODE.ACCOUNT_INACTIVE,
	])('propagates a %s session failure and leaves request.user unset', async (code) => {
		sessionService.authenticate.mockRejectedValueOnce(new SessionException(code))
		const req: any = { headers: { authorization: 'Bearer t' }, cookies: {} }

		const error = await guard.canActivate(makeContext(req)).catch((e) => e)

		expect(error).toBeInstanceOf(SessionException)
		expect(error.getResponse()).toMatchObject({ code })
		expect(req.user).toBeUndefined()
	})

	it('fails closed (503) when the session store is unavailable', async () => {
		sessionService.authenticate.mockRejectedValueOnce(new SessionStoreUnavailableException())
		const req: any = { headers: { authorization: 'Bearer t' }, cookies: {} }

		const error = await guard.canActivate(makeContext(req)).catch((e) => e)

		expect(error).toBeInstanceOf(SessionStoreUnavailableException)
		expect(error.getStatus()).toBe(503)
		expect(req.user).toBeUndefined()
	})
})
