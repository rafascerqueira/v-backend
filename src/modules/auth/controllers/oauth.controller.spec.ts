/**
 * OAuthController unit tests
 * Covers Google + Facebook OAuth flows: state cookie issuance, callback validation,
 * auth cookie setup on success, and redirect on state mismatch / failure.
 */

import { ConfigService } from '@nestjs/config'
import { Test } from '@nestjs/testing'
import { AccountService } from '@/modules/users/services/account.service'
import { OAuthService } from '../services/oauth.service'
import { TokenService } from '../services/token.service'
import { OAuthController } from './oauth.controller'

const FRONTEND_URL = 'http://localhost:3000'

const oauthServiceMock = {
	generateState: jest.fn(),
	verifyState: jest.fn(),
	getGoogleAuthUrl: jest.fn(),
	getFacebookAuthUrl: jest.fn(),
	handleGoogleCallback: jest.fn(),
	handleFacebookCallback: jest.fn(),
}

const tokenServiceMock = {
	generateTokens: jest.fn(),
}

const accountServiceMock = {
	updateLastLogin: jest.fn(),
}

const configServiceMock = {
	get: jest.fn((_key: string, fallback?: unknown) => FRONTEND_URL ?? fallback),
}

function makeReply() {
	return {
		setCookie: jest.fn(),
		clearCookie: jest.fn(),
		redirect: jest.fn().mockImplementation(function (this: unknown, url: string) {
			return { url, this: this }
		}),
	}
}

function makeRequest(cookies: Record<string, string> = {}) {
	return { cookies }
}

describe('OAuthController', () => {
	let controller: OAuthController

	beforeEach(async () => {
		const moduleRef = await Test.createTestingModule({
			controllers: [OAuthController],
			providers: [
				{ provide: OAuthService, useValue: oauthServiceMock },
				{ provide: TokenService, useValue: tokenServiceMock },
				{ provide: AccountService, useValue: accountServiceMock },
				{ provide: ConfigService, useValue: configServiceMock },
			],
		}).compile()

		controller = moduleRef.get(OAuthController)
		jest.clearAllMocks()
	})

	describe('googleLogin', () => {
		it('generates state, sets oauth_state cookie and redirects to provider', async () => {
			oauthServiceMock.generateState.mockReturnValue('state-google')
			oauthServiceMock.getGoogleAuthUrl.mockReturnValue(
				'https://accounts.google.com/x?state=state-google',
			)
			const reply = makeReply()

			await controller.googleLogin(reply as any)

			expect(reply.setCookie).toHaveBeenCalledWith(
				'oauth_state',
				'state-google',
				expect.objectContaining({ httpOnly: true, maxAge: 600 }),
			)
			expect(oauthServiceMock.getGoogleAuthUrl).toHaveBeenCalledWith('state-google')
			expect(reply.redirect).toHaveBeenCalledWith(
				'https://accounts.google.com/x?state=state-google',
				302,
			)
		})
	})

	describe('googleCallback', () => {
		const account = { id: 'acc-1', email: 'u@x.com', role: 'user', plan_type: 'free' }
		const tokens = { accessToken: 'access', refreshToken: 'refresh', expiresIn: 86400 }

		it('redirects to /login?error=oauth_state when state mismatch', async () => {
			oauthServiceMock.verifyState.mockReturnValue(false)
			const reply = makeReply()
			const request = makeRequest({ oauth_state: 'cookie-state' })

			await controller.googleCallback('code', 'query-state', request as any, reply as any)

			expect(reply.clearCookie).toHaveBeenCalledWith('oauth_state', expect.any(Object))
			expect(oauthServiceMock.verifyState).toHaveBeenCalledWith('cookie-state', 'query-state')
			expect(oauthServiceMock.handleGoogleCallback).not.toHaveBeenCalled()
			expect(reply.redirect).toHaveBeenCalledWith(`${FRONTEND_URL}/login?error=oauth_state`, 302)
		})

		it('completes login flow on valid state and redirects to /dashboard', async () => {
			oauthServiceMock.verifyState.mockReturnValue(true)
			oauthServiceMock.handleGoogleCallback.mockResolvedValueOnce(account)
			tokenServiceMock.generateTokens.mockResolvedValueOnce(tokens)
			const reply = makeReply()
			const request = makeRequest({ oauth_state: 'state' })

			await controller.googleCallback('code', 'state', request as any, reply as any)

			expect(oauthServiceMock.handleGoogleCallback).toHaveBeenCalledWith('code')
			expect(accountServiceMock.updateLastLogin).toHaveBeenCalledWith('acc-1')
			expect(tokenServiceMock.generateTokens).toHaveBeenCalledWith({
				sub: 'acc-1',
				email: 'u@x.com',
				role: 'user',
				plan_type: 'free',
			})
			expect(reply.setCookie).toHaveBeenCalledWith(
				'access_token',
				'access',
				expect.objectContaining({ maxAge: 86400 }),
			)
			expect(reply.setCookie).toHaveBeenCalledWith(
				'refresh_token',
				'refresh',
				expect.objectContaining({ maxAge: 7 * 24 * 60 * 60 }),
			)
			expect(reply.redirect).toHaveBeenCalledWith(`${FRONTEND_URL}/dashboard`, 302)
		})

		it('redirects to /login?error=oauth_failed when provider exchange throws', async () => {
			oauthServiceMock.verifyState.mockReturnValue(true)
			oauthServiceMock.handleGoogleCallback.mockRejectedValueOnce(new Error('boom'))
			const reply = makeReply()
			const request = makeRequest({ oauth_state: 'state' })

			await controller.googleCallback('code', 'state', request as any, reply as any)

			expect(reply.redirect).toHaveBeenCalledWith(`${FRONTEND_URL}/login?error=oauth_failed`, 302)
		})
	})

	describe('facebookLogin', () => {
		it('generates state, sets oauth_state cookie and redirects to provider', async () => {
			oauthServiceMock.generateState.mockReturnValue('state-fb')
			oauthServiceMock.getFacebookAuthUrl.mockReturnValue(
				'https://www.facebook.com/v20.0/dialog/oauth?state=state-fb',
			)
			const reply = makeReply()

			await controller.facebookLogin(reply as any)

			expect(reply.setCookie).toHaveBeenCalledWith(
				'oauth_state',
				'state-fb',
				expect.objectContaining({ httpOnly: true, maxAge: 600 }),
			)
			expect(oauthServiceMock.getFacebookAuthUrl).toHaveBeenCalledWith('state-fb')
			expect(reply.redirect).toHaveBeenCalledWith(
				'https://www.facebook.com/v20.0/dialog/oauth?state=state-fb',
				302,
			)
		})
	})

	describe('facebookCallback', () => {
		const account = { id: 'acc-2', email: 'fb@x.com', role: 'user', plan_type: 'free' }
		const tokens = { accessToken: 'access2', refreshToken: 'refresh2', expiresIn: 86400 }

		it('redirects to /login?error=oauth_state when state mismatch', async () => {
			oauthServiceMock.verifyState.mockReturnValue(false)
			const reply = makeReply()
			const request = makeRequest({ oauth_state: 'a' })

			await controller.facebookCallback('code', 'b', request as any, reply as any)

			expect(reply.clearCookie).toHaveBeenCalledWith('oauth_state', expect.any(Object))
			expect(oauthServiceMock.handleFacebookCallback).not.toHaveBeenCalled()
			expect(reply.redirect).toHaveBeenCalledWith(`${FRONTEND_URL}/login?error=oauth_state`, 302)
		})

		it('completes login flow on valid state and redirects to /dashboard', async () => {
			oauthServiceMock.verifyState.mockReturnValue(true)
			oauthServiceMock.handleFacebookCallback.mockResolvedValueOnce(account)
			tokenServiceMock.generateTokens.mockResolvedValueOnce(tokens)
			const reply = makeReply()
			const request = makeRequest({ oauth_state: 'state' })

			await controller.facebookCallback('code', 'state', request as any, reply as any)

			expect(oauthServiceMock.handleFacebookCallback).toHaveBeenCalledWith('code')
			expect(accountServiceMock.updateLastLogin).toHaveBeenCalledWith('acc-2')
			expect(tokenServiceMock.generateTokens).toHaveBeenCalledWith({
				sub: 'acc-2',
				email: 'fb@x.com',
				role: 'user',
				plan_type: 'free',
			})
			expect(reply.setCookie).toHaveBeenCalledWith('access_token', 'access2', expect.any(Object))
			expect(reply.redirect).toHaveBeenCalledWith(`${FRONTEND_URL}/dashboard`, 302)
		})

		it('redirects to /login?error=oauth_failed when Facebook exchange throws', async () => {
			oauthServiceMock.verifyState.mockReturnValue(true)
			oauthServiceMock.handleFacebookCallback.mockRejectedValueOnce(new Error('boom'))
			const reply = makeReply()
			const request = makeRequest({ oauth_state: 'state' })

			await controller.facebookCallback('code', 'state', request as any, reply as any)

			expect(reply.redirect).toHaveBeenCalledWith(`${FRONTEND_URL}/login?error=oauth_failed`, 302)
		})
	})
})
