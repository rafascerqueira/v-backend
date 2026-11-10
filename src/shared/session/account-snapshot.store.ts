import { Injectable, Logger } from '@nestjs/common'
import type { AccountRole, PlanType } from '@/generated/prisma/client'
import { RedisService } from '@/shared/redis/redis.service'

/** The account fields every authenticated request depends on. */
export interface AccountSnapshot {
	email: string
	role: AccountRole
	plan_type: PlanType
	is_active: boolean
	session_version: number
}

/** How long a snapshot may be served before the account is read again. */
export const ACCOUNT_SNAPSHOT_TTL_SECONDS = 60

const KEY_PREFIX = 'auth:account:'

function isSnapshot(value: unknown): value is AccountSnapshot {
	if (typeof value !== 'object' || value === null) return false
	const candidate = value as Record<string, unknown>
	return (
		typeof candidate.email === 'string' &&
		typeof candidate.role === 'string' &&
		typeof candidate.plan_type === 'string' &&
		typeof candidate.is_active === 'boolean' &&
		typeof candidate.session_version === 'number'
	)
}

/**
 * Short-lived Redis copy of the account state used to authenticate requests, so the
 * guard does not hit Postgres on every call. Every repository method that changes one
 * of these fields calls `invalidate`, which makes the change visible on the account's
 * next request. The TTL bounds the staleness if an invalidation is ever missed.
 *
 * Lives in `shared/` (and depends only on Redis) so repositories of any module can
 * invalidate without importing the auth module.
 */
@Injectable()
export class AccountSnapshotStore {
	private readonly logger = new Logger(AccountSnapshotStore.name)

	constructor(private readonly redis: RedisService) {}

	key(accountId: string): string {
		return `${KEY_PREFIX}${accountId}`
	}

	parse(raw: string | null): AccountSnapshot | null {
		if (!raw) return null
		try {
			const parsed: unknown = JSON.parse(raw)
			return isSnapshot(parsed) ? parsed : null
		} catch {
			return null
		}
	}

	async set(accountId: string, snapshot: AccountSnapshot): Promise<void> {
		await this.redis.setWithExpiry(
			this.key(accountId),
			JSON.stringify(snapshot),
			ACCOUNT_SNAPSHOT_TTL_SECONDS,
		)
	}

	/**
	 * Drop the cached copy after a write. The write is already committed when this runs,
	 * so a Redis failure is logged instead of thrown: the stale copy then lives at most
	 * `ACCOUNT_SNAPSHOT_TTL_SECONDS`.
	 */
	async invalidate(accountId: string): Promise<void> {
		try {
			await this.redis.delete(this.key(accountId))
		} catch (error) {
			this.logger.error(
				`Failed to invalidate the account snapshot for ${accountId}: ${(error as Error).message}`,
			)
		}
	}
}
