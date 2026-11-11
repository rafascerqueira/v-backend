/**
 * LogoutController unit tests
 * Covers: POST /auth/logout — ends the session the cookies point to, always clears
 *         the cookies; POST /auth/logout-all — ends every session of the account.
 * Guards mocked: JwtAuthGuard (global default)
 */

import { Test } from '@nestjs/testing'
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard'
import { SessionService } from '../services/session.service'
import { SessionStoreUnavailableException } from '../session/session.errors'
import { LogoutController } from './logout.controller'

const sessionServiceMock = {
	revokeByTokens: jest.fn(),
	revokeAllForAccount: jest.fn(),
	revoke: jest.fn(),
}

function makeResponse() {
	return { clearCookie: jest.fn() }
}

function makeRequest(cookies: Record<string, string> = {}, headers: Record<string, string> = {}) {
	return { cookies, headers }
}

const clearedNames = (res: ReturnType<typeof makeResponse>) =>
	res.clearCookie.mock.calls.map(([name]) => name)

const ALL_COOKIES = ['access_token', 'refresh_token', 'csrf_token', 'vd_session']

describe('LogoutController', () => {
	let controller: LogoutController

	beforeEach(async () => {
		const module = await Test.createTestingModule({
			controllers: [LogoutController],
			providers: [{ provide: SessionService, useValue: sessionServiceMock }],
		})
			.overrideGuard(JwtAuthGuard)
			.useValue({ canActivate: () => true })
			.compile()

		controller = module.get(LogoutController)
		jest.clearAllMocks()
	})

	describe('logout', () => {
		it('ends the session named by the cookies and clears them', async () => {
			const res = makeResponse()

			const result = await controller.handle(
				makeRequest({ access_token: 'access', refresh_token: 'refresh' }) as any,
				res as any,
			)

			expect(sessionServiceMock.revokeByTokens).toHaveBeenCalledWith({
				accessToken: 'access',
				refreshToken: 'refresh',
			})
			expect(clearedNames(res)).toEqual(expect.arrayContaining(ALL_COOKIES))
			expect(result).toEqual({ message: 'Logout successful' })
		})

		it('uses a Bearer token when one is sent', async () => {
			const res = makeResponse()

			await controller.handle(
				makeRequest({ access_token: 'cookie' }, { authorization: 'Bearer header' }) as any,
				res as any,
			)

			expect(sessionServiceMock.revokeByTokens).toHaveBeenCalledWith({
				accessToken: 'header',
				refreshToken: undefined,
			})
		})

		it('succeeds and still clears the cookies when there is nothing to end', async () => {
			const res = makeResponse()

			await expect(controller.handle(makeRequest() as any, res as any)).resolves.toEqual({
				message: 'Logout successful',
			})

			expect(sessionServiceMock.revokeByTokens).toHaveBeenCalledWith({
				accessToken: undefined,
				refreshToken: undefined,
			})
			expect(clearedNames(res)).toEqual(expect.arrayContaining(ALL_COOKIES))
		})

		it('clears the cookies even when the session store is down', async () => {
			sessionServiceMock.revokeByTokens.mockRejectedValueOnce(
				new SessionStoreUnavailableException(),
			)
			const res = makeResponse()

			await expect(
				controller.handle(makeRequest({ access_token: 'access' }) as any, res as any),
			).rejects.toBeInstanceOf(SessionStoreUnavailableException)

			expect(clearedNames(res)).toEqual(expect.arrayContaining(ALL_COOKIES))
		})
	})

	describe('logoutAll', () => {
		const user = {
			sub: 'acc-1',
			email: 'a@b.com',
			role: 'seller' as const,
			plan_type: 'free' as const,
			sid: 'sid-1',
		}

		it('ends every session of the account, this one included, and clears the cookies', async () => {
			const res = makeResponse()

			const result = await controller.logoutAll(user, res as any)

			expect(sessionServiceMock.revokeAllForAccount).toHaveBeenCalledWith('acc-1')
			expect(sessionServiceMock.revoke).toHaveBeenCalledWith('sid-1')
			expect(clearedNames(res)).toEqual(expect.arrayContaining(ALL_COOKIES))
			expect(result).toEqual({ message: expect.any(String) })
		})

		it('does not clear the cookies if the sessions could not be ended', async () => {
			sessionServiceMock.revokeAllForAccount.mockRejectedValueOnce(new Error('db down'))
			const res = makeResponse()

			await expect(controller.logoutAll(user, res as any)).rejects.toThrow('db down')

			expect(res.clearCookie).not.toHaveBeenCalled()
		})
	})
})
