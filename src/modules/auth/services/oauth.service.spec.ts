/**
 * OAuthService unit tests
 * Covers: state generation/verification, Google/Facebook auth URL building, and Facebook callback flow.
 */

import { UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Test } from '@nestjs/testing'
import { AccountService } from '@/modules/users/services/account.service'
import { OAuthService } from './oauth.service'

const configMap: Record<string, string | undefined> = {
	'oauth.google.clientId': 'google-client-id',
	'oauth.google.clientSecret': 'google-client-secret',
	'oauth.google.callbackUrl': 'http://localhost:3001/auth/google/callback',
	'oauth.facebook.clientId': 'fb-client-id',
	'oauth.facebook.clientSecret': 'fb-client-secret',
	'oauth.facebook.callbackUrl': 'http://localhost:3001/auth/facebook/callback',
}

const configServiceMock = {
	get: jest.fn((key: string) => configMap[key]),
}

const accountServiceMock = {
	findOrCreateOAuthAccount: jest.fn(),
}

function jsonResponse(body: unknown, ok = true, status = 200): Response {
	return {
		ok,
		status,
		json: async () => body,
	} as unknown as Response
}

describe('OAuthService', () => {
	let service: OAuthService

	beforeEach(async () => {
		const moduleRef = await Test.createTestingModule({
			providers: [
				OAuthService,
				{ provide: ConfigService, useValue: configServiceMock },
				{ provide: AccountService, useValue: accountServiceMock },
			],
		}).compile()

		service = moduleRef.get(OAuthService)
		jest.clearAllMocks()
	})

	describe('generateState / verifyState', () => {
		it('generates a 64-char hex string', () => {
			const state = service.generateState()
			expect(state).toMatch(/^[a-f0-9]{64}$/)
		})

		it('returns true when expected and received states match', () => {
			const state = service.generateState()
			expect(service.verifyState(state, state)).toBe(true)
		})

		it('returns false when states differ', () => {
			const a = service.generateState()
			const b = service.generateState()
			expect(service.verifyState(a, b)).toBe(false)
		})

		it('returns false when either state is missing', () => {
			expect(service.verifyState(undefined, 'x')).toBe(false)
			expect(service.verifyState('x', undefined)).toBe(false)
			expect(service.verifyState(undefined, undefined)).toBe(false)
		})

		it('returns false when lengths differ (avoids timingSafeEqual throwing)', () => {
			expect(service.verifyState('aaaa', 'aa')).toBe(false)
		})
	})

	describe('getGoogleAuthUrl', () => {
		it('includes client_id, redirect_uri, scopes and state', () => {
			const url = service.getGoogleAuthUrl('state-123')
			expect(url).toContain('https://accounts.google.com/o/oauth2/v2/auth?')
			expect(url).toContain('client_id=google-client-id')
			expect(url).toContain('redirect_uri=http%3A%2F%2Flocalhost%3A3001%2Fauth%2Fgoogle%2Fcallback')
			expect(url).toContain('scope=openid+email+profile')
			expect(url).toContain('state=state-123')
		})

		it('throws when Google is not configured', () => {
			configServiceMock.get.mockImplementationOnce(() => undefined)
			expect(() => service.getGoogleAuthUrl('s')).toThrow('Google OAuth is not configured')
		})
	})

	describe('getFacebookAuthUrl', () => {
		it('includes client_id, redirect_uri, scopes and state', () => {
			const url = service.getFacebookAuthUrl('fb-state')
			expect(url).toContain('https://www.facebook.com/v20.0/dialog/oauth?')
			expect(url).toContain('client_id=fb-client-id')
			expect(url).toContain(
				'redirect_uri=http%3A%2F%2Flocalhost%3A3001%2Fauth%2Ffacebook%2Fcallback',
			)
			expect(url).toContain('scope=email%2Cpublic_profile')
			expect(url).toContain('state=fb-state')
		})

		it('throws when Facebook is not configured', () => {
			configServiceMock.get.mockImplementationOnce(() => undefined)
			expect(() => service.getFacebookAuthUrl('s')).toThrow('Facebook OAuth is not configured')
		})
	})

	describe('handleFacebookCallback', () => {
		const account = { id: 'acc-1', email: 'user@example.com' }

		it('exchanges code for token, fetches user info and finds or creates account', async () => {
			const fetchMock = jest
				.spyOn(global, 'fetch')
				.mockResolvedValueOnce(jsonResponse({ access_token: 'fb-access', token_type: 'bearer' }))
				.mockResolvedValueOnce(
					jsonResponse({ id: 'fb-id-1', name: 'John Doe', email: 'user@example.com' }),
				)
			accountServiceMock.findOrCreateOAuthAccount.mockResolvedValueOnce(account)

			const result = await service.handleFacebookCallback('code-xyz')

			expect(fetchMock).toHaveBeenCalledTimes(2)
			const tokenCall = fetchMock.mock.calls[0]?.[0] as string
			expect(tokenCall).toContain('graph.facebook.com/v20.0/oauth/access_token')
			expect(tokenCall).toContain('code=code-xyz')
			expect(tokenCall).toContain('client_id=fb-client-id')
			expect(tokenCall).toContain('client_secret=fb-client-secret')

			const userCall = fetchMock.mock.calls[1]?.[0] as string
			expect(userCall).toContain('graph.facebook.com/me')
			expect(userCall).toContain('access_token=fb-access')
			expect(userCall).toContain('fields=id%2Cname%2Cemail')

			expect(accountServiceMock.findOrCreateOAuthAccount).toHaveBeenCalledWith({
				name: 'John Doe',
				email: 'user@example.com',
				facebookId: 'fb-id-1',
			})
			expect(result).toBe(account)

			fetchMock.mockRestore()
		})

		it('throws UnauthorizedException when token exchange fails', async () => {
			const fetchMock = jest
				.spyOn(global, 'fetch')
				.mockResolvedValueOnce(jsonResponse({ error: 'invalid' }, false, 400))

			await expect(service.handleFacebookCallback('bad-code')).rejects.toThrow(
				UnauthorizedException,
			)

			fetchMock.mockRestore()
		})

		it('throws UnauthorizedException when user info fetch fails', async () => {
			const fetchMock = jest
				.spyOn(global, 'fetch')
				.mockResolvedValueOnce(jsonResponse({ access_token: 'fb-access', token_type: 'bearer' }))
				.mockResolvedValueOnce(jsonResponse({ error: 'forbidden' }, false, 403))

			await expect(service.handleFacebookCallback('code-xyz')).rejects.toThrow(
				UnauthorizedException,
			)

			fetchMock.mockRestore()
		})

		it('throws UnauthorizedException when Facebook does not return an email', async () => {
			const fetchMock = jest
				.spyOn(global, 'fetch')
				.mockResolvedValueOnce(jsonResponse({ access_token: 'fb-access', token_type: 'bearer' }))
				.mockResolvedValueOnce(jsonResponse({ id: 'fb-id-2', name: 'No Email' }))

			await expect(service.handleFacebookCallback('code-xyz')).rejects.toThrow(
				UnauthorizedException,
			)
			expect(accountServiceMock.findOrCreateOAuthAccount).not.toHaveBeenCalled()

			fetchMock.mockRestore()
		})

		it('throws UnauthorizedException when Facebook OAuth is not configured', async () => {
			configServiceMock.get.mockImplementationOnce(() => undefined)

			await expect(service.handleFacebookCallback('code')).rejects.toThrow(UnauthorizedException)
		})
	})
})
