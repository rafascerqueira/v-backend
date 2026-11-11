/**
 * TokenService unit tests
 * Covers: signAccessToken, signRefreshToken, verifyAccessToken, verifyRefreshToken
 * Verifies: RS256 sign/verify delegation, session claims only (no role/plan/e-mail),
 *           token-type confusion, tokens without a session reference, ignoreExpiration.
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
			'jwt.accessTokenExpiresIn': '15m',
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

const session = { sub: 'acc-1', sid: 'sid-1', sv: 3 }

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

		service = module.get(TokenService)
		await service.onModuleInit()
		jest.clearAllMocks()
	})

	it('exposes the access-token lifetime in seconds', () => {
		expect(service.accessTokenTtl).toBe(900)
	})

	describe('signAccessToken', () => {
		it('signs RS256 with the session reference and nothing about role, plan or e-mail', async () => {
			jwtServiceMock.signAsync.mockResolvedValueOnce('access.jwt')

			await expect(service.signAccessToken(session)).resolves.toBe('access.jwt')

			const [payload, options] = jwtServiceMock.signAsync.mock.calls[0]
			expect(payload).toEqual({
				sub: 'acc-1',
				sid: 'sid-1',
				sv: 3,
				jti: expect.any(String),
				type: 'access',
			})
			expect(options).toEqual({
				privateKey: 'FAKE_PRIVATE_KEY',
				algorithm: 'RS256',
				expiresIn: 900,
			})
		})

		it('gives every access token its own jti', async () => {
			jwtServiceMock.signAsync.mockResolvedValue('jwt')

			await service.signAccessToken(session)
			await service.signAccessToken(session)

			const [first, second] = jwtServiceMock.signAsync.mock.calls.map(([payload]) => payload.jti)
			expect(first).not.toBe(second)
		})
	})

	describe('signRefreshToken', () => {
		it('carries the rotation id it is given and the requested lifetime', async () => {
			jwtServiceMock.signAsync.mockResolvedValueOnce('refresh.jwt')

			await expect(service.signRefreshToken({ ...session, jti: 'rot-1' }, 2592000)).resolves.toBe(
				'refresh.jwt',
			)

			expect(jwtServiceMock.signAsync).toHaveBeenCalledWith(
				{ sub: 'acc-1', sid: 'sid-1', sv: 3, jti: 'rot-1', type: 'refresh' },
				{ privateKey: 'FAKE_PRIVATE_KEY', algorithm: 'RS256', expiresIn: 2592000 },
			)
		})
	})

	describe('verifyAccessToken', () => {
		const claims = { ...session, jti: 'j-1', type: 'access' }

		it('returns the claims of a valid access token', async () => {
			jwtServiceMock.verifyAsync.mockResolvedValueOnce(claims)

			await expect(service.verifyAccessToken('token')).resolves.toEqual(claims)
			expect(jwtServiceMock.verifyAsync).toHaveBeenCalledWith('token', {
				publicKey: 'FAKE_PUBLIC_KEY',
				algorithms: ['RS256'],
				ignoreExpiration: false,
			})
		})

		it('rejects a refresh token presented as an access token', async () => {
			jwtServiceMock.verifyAsync.mockResolvedValueOnce({ ...claims, type: 'refresh' })

			await expect(service.verifyAccessToken('token')).rejects.toThrow('Invalid token type')
		})

		it.each([
			['sid', { sid: undefined }],
			['sv', { sv: undefined }],
			['sv as a string', { sv: '3' }],
			['jti', { jti: undefined }],
			['sub', { sub: undefined }],
		])('rejects a token without a usable %s (issued before sessions existed)', async (_, patch) => {
			jwtServiceMock.verifyAsync.mockResolvedValueOnce({ ...claims, ...patch })

			await expect(service.verifyAccessToken('token')).rejects.toThrow('Invalid token claims')
		})

		it('propagates signature / expiry failures', async () => {
			jwtServiceMock.verifyAsync.mockRejectedValueOnce(new Error('jwt expired'))

			await expect(service.verifyAccessToken('token')).rejects.toThrow('jwt expired')
		})

		it('can accept an expired token when asked to (logout)', async () => {
			jwtServiceMock.verifyAsync.mockResolvedValueOnce(claims)

			await service.verifyAccessToken('token', { ignoreExpiration: true })

			expect(jwtServiceMock.verifyAsync).toHaveBeenCalledWith(
				'token',
				expect.objectContaining({ ignoreExpiration: true }),
			)
		})
	})

	describe('verifyRefreshToken', () => {
		const claims = { ...session, jti: 'rot-1', type: 'refresh' }

		it('returns the claims of a valid refresh token', async () => {
			jwtServiceMock.verifyAsync.mockResolvedValueOnce(claims)

			await expect(service.verifyRefreshToken('token')).resolves.toEqual(claims)
		})

		it('rejects an access token presented as a refresh token', async () => {
			jwtServiceMock.verifyAsync.mockResolvedValueOnce({ ...claims, type: 'access' })

			await expect(service.verifyRefreshToken('token')).rejects.toThrow('Invalid token type')
		})
	})

	describe('onModuleInit', () => {
		it('refuses to start without both RS256 keys', async () => {
			const fs = jest.requireMock('node:fs') as { existsSync: jest.Mock }
			fs.existsSync.mockReturnValueOnce(false)

			expect(() => service.onModuleInit()).toThrow(/RS256 JWT keys not found/)
		})
	})
})
