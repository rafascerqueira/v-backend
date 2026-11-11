/**
 * SessionService unit tests.
 * Covers: create, authenticate, refresh (rotation, grace window, reuse, limits),
 *         reissue, revoke, revokeByTokens, revokeAllForAccount, and the fail-closed
 *         behaviour when the session store is down.
 *
 * Redis is an in-memory fake. Its `evalScript` re-implements the rotation script in
 * JS so the service's handling of each outcome can be driven; the real Lua script
 * (and its atomicity) is exercised against Redis in test/auth-session.e2e-spec.ts.
 */
import type { ConfigService } from '@nestjs/config'
import type { RedisService } from '@/shared/redis/redis.service'
import type { AccountRepository } from '@/shared/repositories/account.repository'
import { type AccountSnapshot, AccountSnapshotStore } from '@/shared/session/account-snapshot.store'
import {
	SESSION_ERROR_CODE,
	SessionException,
	SessionStoreUnavailableException,
} from '../session/session.errors'
import type { SessionTokenClaims } from '../session/session.types'
import { REFRESH_GRACE_MS, SessionService } from './session.service'
import type { TokenService } from './token.service'

const DAY = 86400
const NOW = Date.UTC(2026, 10, 10, 12, 0, 0)

class FakeRedis {
	hashes = new Map<string, Record<string, string>>()
	strings = new Map<string, string>()
	ttls = new Map<string, number>()
	down = false

	private guard() {
		if (this.down) throw new Error('ECONNREFUSED')
	}

	async get(key: string) {
		this.guard()
		return this.strings.get(key) ?? null
	}

	async setWithExpiry(key: string, value: string, ttl: number) {
		this.guard()
		this.strings.set(key, value)
		this.ttls.set(key, ttl)
	}

	async delete(key: string) {
		this.guard()
		this.strings.delete(key)
		this.hashes.delete(key)
		this.ttls.delete(key)
	}

	async getHash(key: string) {
		this.guard()
		return { ...(this.hashes.get(key) ?? {}) }
	}

	async setHashWithExpiry(key: string, fields: Record<string, string>, ttl: number) {
		this.guard()
		this.hashes.set(key, { ...(this.hashes.get(key) ?? {}), ...fields })
		this.ttls.set(key, ttl)
	}

	// Mirrors ROTATE_SCRIPT in session.service.ts.
	async evalScript(_script: string, [key]: string[], args: string[]) {
		this.guard()
		const [presented, next, nowRaw, graceUntil, idlePersistent, idleBrowser, sub] = args
		const session = this.hashes.get(key)
		if (!session || session.sub !== sub) return ['missing', '0', '0']
		const now = Number(nowRaw)
		const absolute = Number(session.absolute_exp)
		if (!(absolute > now)) {
			this.hashes.delete(key)
			return ['expired', '0', '0']
		}
		if (session.rjti === presented) {
			const idle = Number(session.persistent === '1' ? idlePersistent : idleBrowser)
			const ttl = Math.min(idle, Math.ceil((absolute - now) / 1000))
			Object.assign(session, { rjti: next, prev_rjti: presented, prev_until: graceUntil })
			this.ttls.set(key, ttl)
			return ['rotated', String(ttl), session.persistent]
		}
		if (session.prev_rjti === presented && Number(session.prev_until) >= now) {
			return ['grace', String(this.ttls.get(key) ?? 0), session.persistent]
		}
		this.hashes.delete(key)
		return ['reuse', '0', '0']
	}
}

/** Token "signing" that keeps the claims readable, so tests can inspect them. */
function makeTokenService() {
	const decode = (token: string, type: string, ignoreExpiration?: boolean) => {
		const claims = JSON.parse(token) as SessionTokenClaims & { exp: number }
		if (claims.type !== type) throw new Error('Invalid token type')
		if (!ignoreExpiration && claims.exp * 1000 <= Date.now()) throw new Error('jwt expired')
		return claims
	}
	let counter = 0
	return {
		accessTokenTtl: 900,
		signAccessToken: jest.fn(async (s: { sub: string; sid: string; sv: number }) =>
			JSON.stringify({
				...s,
				jti: `access-${++counter}`,
				type: 'access',
				exp: Math.floor(Date.now() / 1000) + 900,
			}),
		),
		signRefreshToken: jest.fn(
			async (s: { sub: string; sid: string; sv: number; jti: string }, ttl: number) =>
				JSON.stringify({ ...s, type: 'refresh', exp: Math.floor(Date.now() / 1000) + ttl }),
		),
		verifyAccessToken: jest.fn(async (token: string, options?: { ignoreExpiration?: boolean }) =>
			decode(token, 'access', options?.ignoreExpiration),
		),
		verifyRefreshToken: jest.fn(async (token: string, options?: { ignoreExpiration?: boolean }) =>
			decode(token, 'refresh', options?.ignoreExpiration),
		),
	}
}

const claimsOf = (token: string | undefined) => JSON.parse(token ?? '{}') as SessionTokenClaims

describe('SessionService', () => {
	let redis: FakeRedis
	let tokens: ReturnType<typeof makeTokenService>
	let snapshots: AccountSnapshotStore
	let account: AccountSnapshot
	let accountRepository: { findSessionState: jest.Mock; bumpSessionVersion: jest.Mock }
	let service: SessionService
	let warn: jest.SpyInstance

	const sessionKey = (sid: string) => `auth:session:${sid}`
	const advance = (ms: number) => jest.setSystemTime(Date.now() + ms)

	beforeEach(() => {
		jest.useFakeTimers().setSystemTime(NOW)
		redis = new FakeRedis()
		tokens = makeTokenService()
		snapshots = new AccountSnapshotStore(redis as unknown as RedisService)
		account = {
			email: 'seller@example.com',
			role: 'seller',
			plan_type: 'free',
			is_active: true,
			session_version: 0,
		}
		accountRepository = {
			findSessionState: jest.fn(async () => ({ ...account })),
			bumpSessionVersion: jest.fn(async () => {
				account.session_version += 1
				await snapshots.invalidate('acc-1')
			}),
		}
		const config = { get: jest.fn(() => undefined) }
		service = new SessionService(
			redis as unknown as RedisService,
			tokens as unknown as TokenService,
			snapshots,
			accountRepository as unknown as AccountRepository,
			config as unknown as ConfigService,
		)
		warn = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined)
		jest.spyOn((service as any).logger, 'error').mockImplementation(() => undefined)
		jest.spyOn((snapshots as any).logger, 'error').mockImplementation(() => undefined)
	})

	afterEach(() => {
		jest.useRealTimers()
	})

	const login = (persistent = true) =>
		service.create({ id: 'acc-1', session_version: account.session_version }, { persistent })

	describe('create', () => {
		it('stores a session and issues tokens that carry only the session reference', async () => {
			const issued = await login()

			const access = claimsOf(issued.accessToken)
			const refresh = claimsOf(issued.refreshToken)
			expect(access).toMatchObject({ sub: 'acc-1', sv: 0, type: 'access' })
			expect(refresh).toMatchObject({ sub: 'acc-1', sv: 0, type: 'refresh', sid: access.sid })
			expect(access).not.toHaveProperty('role')
			expect(access).not.toHaveProperty('plan_type')
			expect(access).not.toHaveProperty('email')

			expect(redis.hashes.get(sessionKey(access.sid))).toEqual({
				sub: 'acc-1',
				rjti: refresh.jti,
				prev_rjti: '',
				prev_until: '0',
				created_at: String(NOW),
				absolute_exp: String(NOW + 90 * DAY * 1000),
				persistent: '1',
			})
			expect(issued).toMatchObject({ expiresIn: 900, persistent: true, sessionTtl: 30 * DAY })
			expect(redis.ttls.get(sessionKey(access.sid))).toBe(30 * DAY)
		})

		it('caps a browser session ("keep me signed in" off) at 12 hours', async () => {
			const issued = await login(false)

			const { sid } = claimsOf(issued.accessToken)
			expect(issued).toMatchObject({ persistent: false, sessionTtl: 12 * 3600 })
			expect(redis.hashes.get(sessionKey(sid))).toMatchObject({
				persistent: '0',
				absolute_exp: String(NOW + 12 * 3600 * 1000),
			})
		})

		it('gives every login its own session', async () => {
			const first = claimsOf((await login()).accessToken)
			const second = claimsOf((await login()).accessToken)

			expect(first.sid).not.toBe(second.sid)
		})

		it('fails with 503 when the session cannot be stored', async () => {
			redis.down = true

			await expect(login()).rejects.toBeInstanceOf(SessionStoreUnavailableException)
		})
	})

	describe('authenticate', () => {
		it('returns the user with role, plan and e-mail read from the account', async () => {
			const issued = await login()

			await expect(service.authenticate(issued.accessToken)).resolves.toEqual({
				sub: 'acc-1',
				email: 'seller@example.com',
				role: 'seller',
				plan_type: 'free',
				sid: claimsOf(issued.accessToken).sid,
			})
		})

		it('serves the cached account copy without reading the database again', async () => {
			const issued = await login()

			await service.authenticate(issued.accessToken)
			await service.authenticate(issued.accessToken)

			expect(accountRepository.findSessionState).toHaveBeenCalledTimes(1)
		})

		it('applies a plan change on the next request once the writer invalidates the copy', async () => {
			const issued = await login()
			await service.authenticate(issued.accessToken)

			account.plan_type = 'pro'
			await snapshots.invalidate('acc-1')

			await expect(service.authenticate(issued.accessToken)).resolves.toMatchObject({
				plan_type: 'pro',
			})
		})

		it('applies a role change the same way, with no new login', async () => {
			const issued = await login()
			account.role = 'admin'
			await service.authenticate(issued.accessToken)

			account.role = 'seller'
			await snapshots.invalidate('acc-1')

			await expect(service.authenticate(issued.accessToken)).resolves.toMatchObject({
				role: 'seller',
			})
		})

		it('reads the database again when the cached copy is unreadable', async () => {
			const issued = await login()
			redis.strings.set(snapshots.key('acc-1'), '{not json')

			await expect(service.authenticate(issued.accessToken)).resolves.toMatchObject({
				sub: 'acc-1',
			})
			expect(accountRepository.findSessionState).toHaveBeenCalledTimes(1)
		})

		const expectCode = async (promise: Promise<unknown>, code: string) => {
			const error = (await promise.catch((e: unknown) => e)) as SessionException
			expect(error).toBeInstanceOf(SessionException)
			expect(error.getStatus()).toBe(401)
			expect(error.getResponse()).toMatchObject({ code })
		}

		it('answers SESSION_EXPIRED for a token that does not verify', async () => {
			await expectCode(service.authenticate('garbage'), SESSION_ERROR_CODE.EXPIRED)
		})

		it('answers SESSION_EXPIRED once the session is gone (logout / idle timeout)', async () => {
			const issued = await login()
			await service.revoke(claimsOf(issued.accessToken).sid)

			await expectCode(service.authenticate(issued.accessToken), SESSION_ERROR_CODE.EXPIRED)
		})

		it('answers SESSION_EXPIRED for a session that belongs to another account', async () => {
			const issued = await login()
			const forged = JSON.stringify({ ...claimsOf(issued.accessToken), sub: 'acc-2' })

			await expectCode(service.authenticate(forged), SESSION_ERROR_CODE.EXPIRED)
		})

		it('answers SESSION_EXPIRED past the absolute limit even if the record lingers', async () => {
			const issued = await login(false)
			const { sid } = claimsOf(issued.accessToken)
			const record = redis.hashes.get(sessionKey(sid))
			if (record) record.absolute_exp = String(NOW - 1)

			await expectCode(service.authenticate(issued.accessToken), SESSION_ERROR_CODE.EXPIRED)
		})

		it('answers SESSION_REVOKED when the token predates the session version', async () => {
			const issued = await login()
			await service.revokeAllForAccount('acc-1')

			await expectCode(service.authenticate(issued.accessToken), SESSION_ERROR_CODE.REVOKED)
		})

		it('answers ACCOUNT_INACTIVE for a deactivated account', async () => {
			const issued = await login()
			account.is_active = false

			await expectCode(
				service.authenticate(issued.accessToken),
				SESSION_ERROR_CODE.ACCOUNT_INACTIVE,
			)
		})

		it('answers SESSION_REVOKED when the account no longer exists', async () => {
			const issued = await login()
			accountRepository.findSessionState.mockResolvedValueOnce(null)

			await expectCode(service.authenticate(issued.accessToken), SESSION_ERROR_CODE.REVOKED)
		})

		it('fails closed with 503 when the session store is unreachable', async () => {
			const issued = await login()
			redis.down = true

			const error = await service.authenticate(issued.accessToken).catch((e) => e)

			expect(error).toBeInstanceOf(SessionStoreUnavailableException)
			expect(error.getStatus()).toBe(503)
		})
	})

	describe('refresh', () => {
		const expectCode = async (promise: Promise<unknown>, code: string) => {
			const error = (await promise.catch((e: unknown) => e)) as SessionException
			expect(error).toBeInstanceOf(SessionException)
			expect(error.getResponse()).toMatchObject({ code })
		}

		it('rotates the refresh token and keeps the same session', async () => {
			const issued = await login()
			const before = claimsOf(issued.refreshToken)

			const renewed = await service.refresh(issued.refreshToken ?? '')

			const after = claimsOf(renewed.refreshToken)
			expect(after.sid).toBe(before.sid)
			expect(after.jti).not.toBe(before.jti)
			expect(redis.hashes.get(sessionKey(before.sid))).toMatchObject({
				rjti: after.jti,
				prev_rjti: before.jti,
				prev_until: String(NOW + REFRESH_GRACE_MS),
			})
			expect(renewed).toMatchObject({ expiresIn: 900, persistent: true, sessionTtl: 30 * DAY })
			await expect(service.authenticate(renewed.accessToken)).resolves.toMatchObject({
				sub: 'acc-1',
			})
		})

		it('reads the account from the database, never from the cached copy', async () => {
			const issued = await login()
			await service.authenticate(issued.accessToken) // warms the cache with plan "free"
			account.plan_type = 'pro' // changed without invalidation

			const renewed = await service.refresh(issued.refreshToken ?? '')

			// The refresh re-read the account and refreshed the copy the guard serves.
			await expect(service.authenticate(renewed.accessToken)).resolves.toMatchObject({
				plan_type: 'pro',
			})
		})

		it('honours the previous token inside the grace window without rotating again', async () => {
			const issued = await login()
			const first = await service.refresh(issued.refreshToken ?? '')
			advance(REFRESH_GRACE_MS - 1)

			const second = await service.refresh(issued.refreshToken ?? '')

			expect(second.refreshToken).toBeUndefined()
			expect(claimsOf(second.accessToken).sid).toBe(claimsOf(first.accessToken).sid)
			// The session still expects the token the first caller received.
			const { sid } = claimsOf(first.accessToken)
			expect(redis.hashes.get(sessionKey(sid))?.rjti).toBe(claimsOf(first.refreshToken).jti)
			await expect(service.refresh(first.refreshToken ?? '')).resolves.toMatchObject({
				refreshToken: expect.any(String),
			})
		})

		it('ends the session and logs [REFRESH_REUSE] when an old token returns after the window', async () => {
			const issued = await login()
			const first = await service.refresh(issued.refreshToken ?? '')
			advance(REFRESH_GRACE_MS + 1)

			await expectCode(service.refresh(issued.refreshToken ?? ''), SESSION_ERROR_CODE.REVOKED)

			expect(warn).toHaveBeenCalledWith(expect.stringContaining('[REFRESH_REUSE]'))
			expect(warn).toHaveBeenCalledWith(expect.stringContaining('account=acc-1'))
			// The legitimate holder of the newest token is signed out too.
			await expectCode(service.refresh(first.refreshToken ?? ''), SESSION_ERROR_CODE.EXPIRED)
			await expectCode(service.authenticate(first.accessToken), SESSION_ERROR_CODE.EXPIRED)
		})

		it('never puts token material in the reuse log', async () => {
			const issued = await login()
			await service.refresh(issued.refreshToken ?? '')
			advance(REFRESH_GRACE_MS + 1)
			await service.refresh(issued.refreshToken ?? '').catch(() => undefined)

			const logged = warn.mock.calls.flat().join(' ')
			expect(logged).not.toContain(claimsOf(issued.refreshToken).jti)
		})

		it('answers SESSION_EXPIRED after logout: the old refresh token is dead', async () => {
			const issued = await login()
			await service.revokeByTokens({ refreshToken: issued.refreshToken })

			await expectCode(service.refresh(issued.refreshToken ?? ''), SESSION_ERROR_CODE.EXPIRED)
		})

		it('answers SESSION_EXPIRED for a token that does not verify', async () => {
			await expectCode(service.refresh('garbage'), SESSION_ERROR_CODE.EXPIRED)
		})

		it('answers SESSION_EXPIRED when an access token is presented', async () => {
			const issued = await login()

			await expectCode(service.refresh(issued.accessToken), SESSION_ERROR_CODE.EXPIRED)
		})

		it('answers ACCOUNT_INACTIVE and drops the session of a deactivated account', async () => {
			const issued = await login()
			const { sid } = claimsOf(issued.refreshToken)
			account.is_active = false

			await expectCode(
				service.refresh(issued.refreshToken ?? ''),
				SESSION_ERROR_CODE.ACCOUNT_INACTIVE,
			)
			expect(redis.hashes.has(sessionKey(sid))).toBe(false)
		})

		it('answers SESSION_REVOKED after "sign out everywhere"', async () => {
			const issued = await login()
			await service.revokeAllForAccount('acc-1')

			await expectCode(service.refresh(issued.refreshToken ?? ''), SESSION_ERROR_CODE.REVOKED)
		})

		it('answers SESSION_REVOKED when the account no longer exists', async () => {
			const issued = await login()
			accountRepository.findSessionState.mockResolvedValueOnce(null)

			await expectCode(service.refresh(issued.refreshToken ?? ''), SESSION_ERROR_CODE.REVOKED)
		})

		it('never extends a session beyond its absolute limit', async () => {
			const issued = await login()
			advance(89 * DAY * 1000)
			// Keep the JWT itself valid: only the session's absolute limit is under test.
			const stillValid = JSON.stringify({
				...claimsOf(issued.refreshToken),
				exp: Math.floor(Date.now() / 1000) + DAY,
			})

			const renewed = await service.refresh(stillValid)

			expect(renewed.sessionTtl).toBe(DAY)
			advance(DAY * 1000 + 1)
			const expired = JSON.stringify({
				...claimsOf(renewed.refreshToken),
				exp: Math.floor(Date.now() / 1000) + DAY,
			})
			await expectCode(service.refresh(expired), SESSION_ERROR_CODE.EXPIRED)
		})

		it('fails closed with 503 when the session store is unreachable', async () => {
			const issued = await login()
			redis.down = true

			await expect(service.refresh(issued.refreshToken ?? '')).rejects.toBeInstanceOf(
				SessionStoreUnavailableException,
			)
		})
	})

	describe('reissue', () => {
		it('keeps the current session alive under the new version and drops the others', async () => {
			const here = await login()
			const elsewhere = await login()
			const user = await service.authenticate(here.accessToken)

			await service.revokeAllForAccount('acc-1') // what a password change does
			const reissued = await service.reissue(user)

			expect(claimsOf(reissued.accessToken)).toMatchObject({ sid: user.sid, sv: 1 })
			expect(claimsOf(reissued.refreshToken)).toMatchObject({ sid: user.sid, sv: 1 })
			await expect(service.authenticate(reissued.accessToken)).resolves.toMatchObject({
				sub: 'acc-1',
			})
			await expect(service.refresh(reissued.refreshToken ?? '')).resolves.toBeDefined()

			await expect(service.authenticate(elsewhere.accessToken)).rejects.toMatchObject({
				code: SESSION_ERROR_CODE.REVOKED,
			})
			await expect(service.refresh(elsewhere.refreshToken ?? '')).rejects.toMatchObject({
				code: SESSION_ERROR_CODE.REVOKED,
			})
		})

		it('gives the tokens issued before the change no grace window', async () => {
			const here = await login()
			const user = await service.authenticate(here.accessToken)
			await service.revokeAllForAccount('acc-1')

			await service.reissue(user)

			expect(redis.hashes.get(sessionKey(user.sid))).toMatchObject({
				prev_rjti: '',
				prev_until: '0',
				persistent: '1',
			})
			await expect(service.refresh(here.refreshToken ?? '')).rejects.toMatchObject({
				code: SESSION_ERROR_CODE.REVOKED,
			})
		})

		it('answers SESSION_EXPIRED when the session no longer exists', async () => {
			await expect(service.reissue({ sub: 'acc-1', sid: 'gone' })).rejects.toMatchObject({
				code: SESSION_ERROR_CODE.EXPIRED,
			})
		})

		it('answers ACCOUNT_INACTIVE for a deactivated account', async () => {
			const here = await login()
			const user = await service.authenticate(here.accessToken)
			account.is_active = false

			await expect(service.reissue(user)).rejects.toMatchObject({
				code: SESSION_ERROR_CODE.ACCOUNT_INACTIVE,
			})
		})
	})

	describe('revokeByTokens', () => {
		it('ends the session named by an expired access token', async () => {
			const issued = await login()
			const { sid } = claimsOf(issued.accessToken)
			advance(901 * 1000)

			await service.revokeByTokens({ accessToken: issued.accessToken })

			expect(redis.hashes.has(sessionKey(sid))).toBe(false)
			expect(tokens.verifyAccessToken).toHaveBeenLastCalledWith(issued.accessToken, {
				ignoreExpiration: true,
			})
		})

		it('ignores tokens that do not verify and ends nothing', async () => {
			const issued = await login()
			const { sid } = claimsOf(issued.accessToken)

			await expect(
				service.revokeByTokens({ accessToken: 'garbage', refreshToken: 'garbage' }),
			).resolves.toBeUndefined()
			await expect(service.revokeByTokens({})).resolves.toBeUndefined()

			expect(redis.hashes.has(sessionKey(sid))).toBe(true)
		})

		it('only ends the session the cookies point to', async () => {
			const here = await login()
			const elsewhere = await login()

			await service.revokeByTokens({
				accessToken: here.accessToken,
				refreshToken: here.refreshToken,
			})

			await expect(service.authenticate(elsewhere.accessToken)).resolves.toMatchObject({
				sub: 'acc-1',
			})
		})
	})

	describe('revokeAllForAccount', () => {
		it('bumps the session version through the repository', async () => {
			await service.revokeAllForAccount('acc-1')

			expect(accountRepository.bumpSessionVersion).toHaveBeenCalledWith('acc-1')
		})
	})
})
