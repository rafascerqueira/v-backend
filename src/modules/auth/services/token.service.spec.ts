/**
 * TokenService unit tests
 * Covers: generateTokens, verifyAccessToken, verifyRefreshToken, refreshTokens
 * Verifies: JWT sign/verify delegation, RS256 algorithm, blacklist integration on refresh
 */

import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { Test } from '@nestjs/testing'
import { TokenService } from './token.service'

const jwtServiceMock = {
	signAsync: jest.fn(),
	verifyAsync: jest.fn(),
}

const configServiceMock = {
	get: jest.fn((key: string, defaultValue?: unknown) => {
		const config: Record<string, unknown> = {
			'jwt.accessTokenExpiresIn': '1d',
			'jwt.refreshTokenExpiresIn': '7d',
			'jwt.keysDir': '/fake/keys',
		}
		return config[key] ?? defaultValue
	}),
}

// Mock file system to avoid requiring real key files
jest.mock('node:fs', () => ({
	existsSync: jest.fn().mockReturnValue(true),
	readFileSync: jest.fn((path: string) => {
		if (path.includes('private.pem')) return 'FAKE_PRIVATE_KEY'
		if (path.includes('public.pem')) return 'FAKE_PUBLIC_KEY'
		return ''
	}),
}))

describe('TokenService', () => {
	let service: TokenService

	beforeEach(async () => {
		const module = await Test.createTestingModule({
			providers: [
				TokenService,
				{ provide: JwtService, useValue: jwtServiceMock },
				{ provide: ConfigService, useValue: configServiceMock },
			],
		}).compile()

		// Trigger OnModuleInit lifecycle
		service = module.get(TokenService)
		await service.onModuleInit()
		jest.clearAllMocks()
	})

	describe('generateTokens', () => {
		it('should call signAsync twice and return access and refresh tokens', async () => {
			jwtServiceMock.signAsync
				.mockResolvedValueOnce('access.token.here')
				.mockResolvedValueOnce('refresh.token.here')

			const result = await service.generateTokens({
				sub: 'user-id',
				email: 'user@test.com',
				role: 'seller',
				plan_type: 'free',
			})

			expect(jwtServiceMock.signAsync).toHaveBeenCalledTimes(2)
			expect(result.accessToken).toBe('access.token.here')
			expect(result.refreshToken).toBe('refresh.token.here')
			expect(typeof result.expiresIn).toBe('number')
			expect(result.expiresIn).toBeGreaterThan(0)
		})

		it('should include type: access and type: refresh in respective payloads', async () => {
			jwtServiceMock.signAsync
				.mockResolvedValueOnce('access.token')
				.mockResolvedValueOnce('refresh.token')

			await service.generateTokens({
				sub: 'uid',
				email: 'e@e.com',
				role: 'seller',
				plan_type: 'free',
			})

			const accessPayload = jwtServiceMock.signAsync.mock.calls[0][0]
			const refreshPayload = jwtServiceMock.signAsync.mock.calls[1][0]
			expect(accessPayload.type).toBe('access')
			expect(refreshPayload.type).toBe('refresh')
		})

		it('should sign with RS256 algorithm', async () => {
			jwtServiceMock.signAsync.mockResolvedValue('token')

			await service.generateTokens({
				sub: 'uid',
				email: 'e@e.com',
				role: 'seller',
				plan_type: 'free',
			})

			const opts = jwtServiceMock.signAsync.mock.calls[0][1]
			expect(opts.algorithm).toBe('RS256')
		})
	})

	describe('verifyAccessToken', () => {
		it('should delegate to jwtService.verifyAsync with public key and RS256', async () => {
			const payload = {
				sub: 'uid',
				email: 'e@e.com',
				role: 'seller',
				plan_type: 'free',
				type: 'access',
			}
			jwtServiceMock.verifyAsync.mockResolvedValueOnce(payload)

			const result = await service.verifyAccessToken('some.access.token')

			expect(jwtServiceMock.verifyAsync).toHaveBeenCalledWith(
				'some.access.token',
				expect.objectContaining({ algorithms: ['RS256'] }),
			)
			expect(result).toEqual(payload)
		})
	})

	describe('verifyRefreshToken', () => {
		it('should delegate to jwtService.verifyAsync with public key and RS256', async () => {
			const payload = {
				sub: 'uid',
				email: 'e@e.com',
				role: 'seller',
				plan_type: 'free',
				type: 'refresh',
			}
			jwtServiceMock.verifyAsync.mockResolvedValueOnce(payload)

			const result = await service.verifyRefreshToken('some.refresh.token')

			expect(jwtServiceMock.verifyAsync).toHaveBeenCalledWith(
				'some.refresh.token',
				expect.objectContaining({ algorithms: ['RS256'] }),
			)
			expect(result).toEqual(payload)
		})
	})

	describe('refreshTokens', () => {
		it('should verify old refresh token and generate new tokens', async () => {
			const payload = {
				sub: 'uid',
				email: 'e@e.com',
				role: 'seller',
				plan_type: 'free',
				type: 'refresh',
				exp: Math.floor(Date.now() / 1000) + 3600,
			}
			jwtServiceMock.verifyAsync.mockResolvedValueOnce(payload)
			jwtServiceMock.signAsync
				.mockResolvedValueOnce('new.access.token')
				.mockResolvedValueOnce('new.refresh.token')

			const result = await service.refreshTokens('old.refresh.token')

			expect(result.accessToken).toBe('new.access.token')
			expect(result.refreshToken).toBe('new.refresh.token')
		})

		it('should blacklist the old refresh token when blacklistService is provided', async () => {
			const payload = {
				sub: 'uid',
				email: 'e@e.com',
				role: 'seller',
				plan_type: 'free',
				type: 'refresh',
				exp: Math.floor(Date.now() / 1000) + 3600,
			}
			jwtServiceMock.verifyAsync.mockResolvedValueOnce(payload)
			jwtServiceMock.signAsync.mockResolvedValue('new.token')

			const blacklistService = { addToBlacklist: jest.fn().mockResolvedValue(undefined) }

			await service.refreshTokens('old.refresh.token', blacklistService as any)

			expect(blacklistService.addToBlacklist).toHaveBeenCalledWith(
				'old.refresh.token',
				expect.any(Number),
			)
		})

		it('should not call blacklist when token is already expired (expiresIn <= 0)', async () => {
			const payload = {
				sub: 'uid',
				email: 'e@e.com',
				role: 'seller',
				plan_type: 'free',
				type: 'refresh',
				exp: Math.floor(Date.now() / 1000) - 100,
			}
			jwtServiceMock.verifyAsync.mockResolvedValueOnce(payload)
			jwtServiceMock.signAsync.mockResolvedValue('new.token')

			const blacklistService = { addToBlacklist: jest.fn() }

			await service.refreshTokens('old.refresh.token', blacklistService as any)

			expect(blacklistService.addToBlacklist).not.toHaveBeenCalled()
		})
	})
})
