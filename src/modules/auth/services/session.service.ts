import { randomUUID } from 'node:crypto'
import { Inject, Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { RedisService } from '@/shared/redis/redis.service'
import {
	ACCOUNT_REPOSITORY,
	type AccountRepository,
} from '@/shared/repositories/account.repository'
import { type AccountSnapshot, AccountSnapshotStore } from '@/shared/session/account-snapshot.store'
import {
	SESSION_ERROR_CODE,
	SessionException,
	SessionStoreUnavailableException,
} from '../session/session.errors'
import type { AuthenticatedUser, IssuedSession, SessionTokenClaims } from '../session/session.types'
import { parseDurationSeconds } from '../utils/duration'
import { TokenService } from './token.service'

const SESSION_KEY_PREFIX = 'auth:session:'

/**
 * How long the previous refresh token is still honoured after a rotation. Covers two
 * tabs (or two parallel requests) that present the same token at the same moment: the
 * second one gets a fresh access token instead of tripping reuse detection.
 */
export const REFRESH_GRACE_MS = 10_000

/**
 * Atomic refresh-token rotation (compare-and-swap on the session's current `rjti`).
 * Doing this in one script is what makes N parallel refreshes with the same token end
 * in a single live session: exactly one caller rotates, the others land in the grace
 * branch.
 *
 * KEYS[1] session key
 * ARGV[1] presented jti      ARGV[2] new jti        ARGV[3] now (ms)
 * ARGV[4] grace deadline (ms) ARGV[5] idle TTL (s), persistent session
 * ARGV[6] idle TTL (s), browser session            ARGV[7] account id
 *
 * Returns { outcome, ttlSeconds, persistent }, where outcome is one of
 * rotated | grace | missing | expired | reuse.
 */
const ROTATE_SCRIPT = `
local s = redis.call('HMGET', KEYS[1], 'sub', 'rjti', 'prev_rjti', 'prev_until', 'absolute_exp', 'persistent')
if not s[1] or s[1] ~= ARGV[7] then
	return {'missing', '0', '0'}
end
local now = tonumber(ARGV[3])
local absolute = tonumber(s[5])
if not absolute or absolute <= now then
	redis.call('DEL', KEYS[1])
	return {'expired', '0', '0'}
end
if s[2] == ARGV[1] then
	local idle = tonumber(ARGV[6])
	if s[6] == '1' then idle = tonumber(ARGV[5]) end
	local ttl = math.min(idle, math.ceil((absolute - now) / 1000))
	redis.call('HSET', KEYS[1], 'rjti', ARGV[2], 'prev_rjti', ARGV[1], 'prev_until', ARGV[4])
	redis.call('EXPIRE', KEYS[1], ttl)
	return {'rotated', tostring(ttl), s[6]}
end
if s[3] == ARGV[1] and s[4] and tonumber(s[4]) >= now then
	return {'grace', tostring(redis.call('TTL', KEYS[1])), s[6]}
end
redis.call('DEL', KEYS[1])
return {'reuse', '0', '0'}
`

interface SessionAccount {
	id: string
	session_version: number
}

/**
 * Server-side sessions. A login creates a session record in Redis; the cookies only
 * carry signed pointers to it (`sid`) plus the account's `session_version`. Role, plan
 * and status are read from the account on every request, and a session can be ended
 * individually (logout, reuse detection) or all at once (version bump).
 */
@Injectable()
export class SessionService {
	private readonly logger = new Logger(SessionService.name)
	private readonly idleTtl: number
	private readonly absoluteTtl: number
	private readonly browserTtl: number

	constructor(
		private readonly redis: RedisService,
		private readonly tokenService: TokenService,
		private readonly snapshots: AccountSnapshotStore,
		@Inject(ACCOUNT_REPOSITORY) private readonly accountRepository: AccountRepository,
		configService: ConfigService,
	) {
		// "Keep me signed in": ends after `idleTtl` without use, `absoluteTtl` at most.
		this.idleTtl = parseDurationSeconds(configService.get<string>('session.idleTtl'), 30 * 86400)
		this.absoluteTtl = parseDurationSeconds(
			configService.get<string>('session.absoluteTtl'),
			90 * 86400,
		)
		// Without it: browser-session cookies, and the session ends after `browserTtl`.
		this.browserTtl = parseDurationSeconds(
			configService.get<string>('session.browserTtl'),
			12 * 3600,
		)
	}

	private sessionKey(sid: string): string {
		return `${SESSION_KEY_PREFIX}${sid}`
	}

	/** Starts a session for an account that has just proven its identity. */
	async create(account: SessionAccount, options: { persistent: boolean }): Promise<IssuedSession> {
		const sid = randomUUID()
		const rjti = randomUUID()
		const now = Date.now()
		const lifetime = options.persistent ? this.absoluteTtl : this.browserTtl
		const ttl = Math.min(options.persistent ? this.idleTtl : this.browserTtl, lifetime)

		await this.storeCall(() =>
			this.redis.setHashWithExpiry(
				this.sessionKey(sid),
				{
					sub: account.id,
					rjti,
					prev_rjti: '',
					prev_until: '0',
					created_at: String(now),
					absolute_exp: String(now + lifetime * 1000),
					persistent: options.persistent ? '1' : '0',
				},
				ttl,
			),
		)

		const claims = { sub: account.id, sid, sv: account.session_version }
		const [accessToken, refreshToken] = await Promise.all([
			this.tokenService.signAccessToken(claims),
			this.tokenService.signRefreshToken({ ...claims, jti: rjti }, ttl),
		])

		return {
			accessToken,
			refreshToken,
			expiresIn: this.tokenService.accessTokenTtl,
			persistent: options.persistent,
			sessionTtl: ttl,
		}
	}

	/**
	 * Authenticates a request from its access token: valid signature, a live session,
	 * an active account and a token issued under the account's current session version.
	 * The returned user carries role/plan/e-mail as the account has them now.
	 */
	async authenticate(accessToken: string): Promise<AuthenticatedUser> {
		let claims: SessionTokenClaims
		try {
			claims = await this.tokenService.verifyAccessToken(accessToken)
		} catch {
			throw new SessionException(SESSION_ERROR_CODE.EXPIRED)
		}

		const [session, rawSnapshot] = await this.storeCall(() =>
			Promise.all([
				this.redis.getHash(this.sessionKey(claims.sid)),
				this.redis.get(this.snapshots.key(claims.sub)),
			]),
		)

		if (session.sub !== claims.sub || !(Number(session.absolute_exp) > Date.now())) {
			throw new SessionException(SESSION_ERROR_CODE.EXPIRED)
		}

		const snapshot = this.snapshots.parse(rawSnapshot) ?? (await this.loadSnapshot(claims.sub))
		this.assertUsable(snapshot, claims)

		return {
			sub: claims.sub,
			email: snapshot.email,
			role: snapshot.role,
			plan_type: snapshot.plan_type,
			sid: claims.sid,
		}
	}

	/**
	 * Exchanges a refresh token for new tokens. The account is read from the database
	 * (never from the cache), and the token must be the one the session currently
	 * expects. Presenting an older token outside the grace window ends the session.
	 */
	async refresh(refreshToken: string): Promise<IssuedSession> {
		let claims: SessionTokenClaims
		try {
			claims = await this.tokenService.verifyRefreshToken(refreshToken)
		} catch {
			throw new SessionException(SESSION_ERROR_CODE.EXPIRED)
		}

		const snapshot = await this.loadSnapshot(claims.sub)
		try {
			this.assertUsable(snapshot, claims)
		} catch (error) {
			await this.revoke(claims.sid)
			throw error
		}

		const newJti = randomUUID()
		const now = Date.now()
		const reply = await this.storeCall(() =>
			this.redis.evalScript(
				ROTATE_SCRIPT,
				[this.sessionKey(claims.sid)],
				[
					claims.jti,
					newJti,
					String(now),
					String(now + REFRESH_GRACE_MS),
					String(this.idleTtl),
					String(this.browserTtl),
					claims.sub,
				],
			),
		)
		const [outcome, ttlRaw, persistentRaw] = Array.isArray(reply) ? reply.map(String) : []

		if (outcome === 'reuse') {
			// An already-rotated refresh token came back after the grace window: either a
			// stolen copy or the legitimate one racing a thief. The session is gone either way.
			this.logger.warn(`[REFRESH_REUSE] account=${claims.sub} sid=${claims.sid}`)
			throw new SessionException(SESSION_ERROR_CODE.REVOKED)
		}
		if (outcome !== 'rotated' && outcome !== 'grace') {
			throw new SessionException(SESSION_ERROR_CODE.EXPIRED)
		}

		const sessionTtl = Math.max(parseInt(ttlRaw ?? '0', 10) || 0, 1)
		const base = { sub: claims.sub, sid: claims.sid, sv: snapshot.session_version }
		const accessToken = await this.tokenService.signAccessToken(base)

		return {
			accessToken,
			refreshToken:
				outcome === 'rotated'
					? await this.tokenService.signRefreshToken({ ...base, jti: newJti }, sessionTtl)
					: undefined,
			expiresIn: this.tokenService.accessTokenTtl,
			persistent: persistentRaw === '1',
			sessionTtl,
		}
	}

	/**
	 * Re-issues the caller's own session after a write that bumped the account's
	 * session version (password change): this device stays signed in under the new
	 * version while every other session of the account is refused.
	 */
	async reissue(user: Pick<AuthenticatedUser, 'sub' | 'sid'>): Promise<IssuedSession> {
		const snapshot = await this.loadSnapshot(user.sub)
		if (!snapshot?.is_active) {
			throw new SessionException(SESSION_ERROR_CODE.ACCOUNT_INACTIVE)
		}

		const key = this.sessionKey(user.sid)
		const session = await this.storeCall(() => this.redis.getHash(key))
		const absoluteExp = Number(session.absolute_exp)
		const now = Date.now()
		if (session.sub !== user.sub || !(absoluteExp > now)) {
			throw new SessionException(SESSION_ERROR_CODE.EXPIRED)
		}

		const persistent = session.persistent === '1'
		const idle = persistent ? this.idleTtl : this.browserTtl
		const ttl = Math.max(Math.min(idle, Math.ceil((absoluteExp - now) / 1000)), 1)
		const rjti = randomUUID()
		// No grace for the previous token: it was issued under the old session version.
		await this.storeCall(() =>
			this.redis.setHashWithExpiry(key, { rjti, prev_rjti: '', prev_until: '0' }, ttl),
		)

		const claims = { sub: user.sub, sid: user.sid, sv: snapshot.session_version }
		const [accessToken, refreshToken] = await Promise.all([
			this.tokenService.signAccessToken(claims),
			this.tokenService.signRefreshToken({ ...claims, jti: rjti }, ttl),
		])

		return {
			accessToken,
			refreshToken,
			expiresIn: this.tokenService.accessTokenTtl,
			persistent,
			sessionTtl: ttl,
		}
	}

	/** Ends one session. Safe to call for a session that no longer exists. */
	async revoke(sid: string): Promise<void> {
		await this.storeCall(() => this.redis.delete(this.sessionKey(sid)))
	}

	/**
	 * Ends the session the presented cookies belong to (logout). Works with expired
	 * tokens, so a user whose access token ran out can still sign out; anything that
	 * does not verify is ignored.
	 */
	async revokeByTokens(tokens: { accessToken?: string; refreshToken?: string }): Promise<void> {
		const sids = new Set<string>()
		if (tokens.refreshToken) {
			const claims = await this.tokenService
				.verifyRefreshToken(tokens.refreshToken, { ignoreExpiration: true })
				.catch(() => null)
			if (claims) sids.add(claims.sid)
		}
		if (tokens.accessToken) {
			const claims = await this.tokenService
				.verifyAccessToken(tokens.accessToken, { ignoreExpiration: true })
				.catch(() => null)
			if (claims) sids.add(claims.sid)
		}
		for (const sid of sids) {
			await this.revoke(sid)
		}
	}

	/** "Sign out everywhere": every session of the account stops working at once. */
	async revokeAllForAccount(accountId: string): Promise<void> {
		await this.accountRepository.bumpSessionVersion(accountId)
	}

	private assertUsable(
		snapshot: AccountSnapshot | null,
		claims: SessionTokenClaims,
	): asserts snapshot is AccountSnapshot {
		// A missing account (closed/purged) is indistinguishable from a revoked session.
		if (!snapshot) throw new SessionException(SESSION_ERROR_CODE.REVOKED)
		if (!snapshot.is_active) throw new SessionException(SESSION_ERROR_CODE.ACCOUNT_INACTIVE)
		if (snapshot.session_version !== claims.sv) {
			throw new SessionException(SESSION_ERROR_CODE.REVOKED)
		}
	}

	/** Reads the account from the database and refreshes its cached copy. */
	private async loadSnapshot(accountId: string): Promise<AccountSnapshot | null> {
		const snapshot = await this.accountRepository.findSessionState(accountId)
		if (snapshot) {
			await this.storeCall(() => this.snapshots.set(accountId, snapshot))
		}
		return snapshot
	}

	/** Runs a Redis operation; a store failure becomes 503 and never lets a request in. */
	private async storeCall<T>(operation: () => Promise<T>): Promise<T> {
		try {
			return await operation()
		} catch (error) {
			this.logger.error(`Session store unavailable: ${(error as Error).message}`)
			throw new SessionStoreUnavailableException()
		}
	}
}
