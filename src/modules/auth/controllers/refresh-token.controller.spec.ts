/**
 * RefreshTokenController unit tests
 * Covers: POST /auth/refresh — refresh token read from the HttpOnly cookie only,
 *         cookies rewritten on success, cookies cleared when the session is over,
 *         body carries only expiresIn.
 * Guards mocked: JwtAuthGuard, OriginGuard
 */

import { Test } from '@nestjs/testing'
import { JwtAuthGuard } from '../guards/jwt-auth.guard'
import { OriginGuard } from '../guards/origin.guard'
import { SessionService } from '../services/session.service'
import {
	SESSION_ERROR_CODE,
	SessionException,
	SessionStoreUnavailableException,
} from '../session/session.errors'
import { RefreshTokenController } from './refresh-token.controller'

const sessionServiceMock = {
	refresh: jest.fn(),
}

function makeResponse() {
	return { setCookie: jest.fn(), clearCookie: jest.fn() }
}

const rotated = {
	accessToken: 'new-access',
	refreshToken: 'new-refresh',
	expiresIn: 900,
	persistent: true,
	sessionTtl: 2592000,
}

describe('RefreshTokenController', () => {
	let controller: RefreshTokenController

	beforeEach(async () => {
		const module = await Test.createTestingModule({
			controllers: [RefreshTokenController],
			providers: [{ provide: SessionService, useValue: sessionServiceMock }],
		})
			.overrideGuard(JwtAuthGuard)
			.useValue({ canActivate: () => true })
			.overrideGuard(OriginGuard)
			.useValue({ canActivate: () => true })
			.compile()

		controller = module.get(RefreshTokenController)
		jest.clearAllMocks()
	})

	it('renews the session from the refresh cookie and returns only expiresIn', async () => {
		sessionServiceMock.refresh.mockResolvedValueOnce(rotated)
		const res = makeResponse()

		const result = await controller.handle(
			{ cookies: { refresh_token: 'cookie-refresh' } } as any,
			res as any,
		)

		expect(sessionServiceMock.refresh).toHaveBeenCalledWith('cookie-refresh')
		expect(res.setCookie.mock.calls.map(([name]) => name)).toEqual([
			'access_token',
			'refresh_token',
			'csrf_token',
			'vd_session',
		])
		expect(result).toEqual({ expiresIn: 900 })
		expect(res.clearCookie).not.toHaveBeenCalled()
	})

	it('ignores a refresh token sent in the body: only the cookie counts', async () => {
		const res = makeResponse()
		const request = { cookies: {}, body: { refreshToken: 'body-refresh' } }

		const error = await controller.handle(request as any, res as any).catch((e: unknown) => e)

		expect(error).toBeInstanceOf(SessionException)
		expect((error as SessionException).code).toBe(SESSION_ERROR_CODE.EXPIRED)
		expect(sessionServiceMock.refresh).not.toHaveBeenCalled()
	})

	it('in the grace window sets a new access cookie and no refresh cookie', async () => {
		sessionServiceMock.refresh.mockResolvedValueOnce({ ...rotated, refreshToken: undefined })
		const res = makeResponse()

		const result = await controller.handle(
			{ cookies: { refresh_token: 'cookie-refresh', csrf_token: 'csrf' } } as any,
			res as any,
		)

		expect(res.setCookie.mock.calls.map(([name]) => name)).toEqual(['access_token'])
		expect(result).toEqual({ expiresIn: 900 })
	})

	it.each([
		SESSION_ERROR_CODE.EXPIRED,
		SESSION_ERROR_CODE.REVOKED,
		SESSION_ERROR_CODE.ACCOUNT_INACTIVE,
	])('clears the cookies and answers 401 %s when the session is over', async (code) => {
		sessionServiceMock.refresh.mockRejectedValueOnce(new SessionException(code))
		const res = makeResponse()

		const error = await controller
			.handle({ cookies: { refresh_token: 'cookie-refresh' } } as any, res as any)
			.catch((e: unknown) => e)

		expect(error).toBeInstanceOf(SessionException)
		expect((error as SessionException).getStatus()).toBe(401)
		expect((error as SessionException).code).toBe(code)
		expect(res.clearCookie.mock.calls.map(([name]) => name)).toEqual(
			expect.arrayContaining(['access_token', 'refresh_token', 'csrf_token', 'vd_session']),
		)
		expect(res.setCookie).not.toHaveBeenCalled()
	})

	it('keeps the cookies when the session store is down (503 is not a verdict)', async () => {
		sessionServiceMock.refresh.mockRejectedValueOnce(new SessionStoreUnavailableException())
		const res = makeResponse()

		await expect(
			controller.handle({ cookies: { refresh_token: 'cookie-refresh' } } as any, res as any),
		).rejects.toBeInstanceOf(SessionStoreUnavailableException)

		expect(res.clearCookie).not.toHaveBeenCalled()
	})
})
