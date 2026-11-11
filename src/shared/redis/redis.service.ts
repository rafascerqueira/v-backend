import { randomUUID } from 'node:crypto'
import { Injectable, type OnModuleDestroy } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import Redis, { type Redis as RedisClient } from 'ioredis'

@Injectable()
export class RedisService implements OnModuleDestroy {
	private readonly client: RedisClient

	constructor(readonly configService: ConfigService) {
		this.client = new Redis({
			host: configService.get<string>('redis.host', 'localhost'),
			port: configService.get<number>('redis.port', 6379),
			password: configService.get<string>('redis.password'),
			db: configService.get<number>('redis.db', 0),
			keyPrefix: configService.get<string>('redis.keyPrefix', 'vendinhas:'),
		})
	}

	async onModuleDestroy() {
		await this.client.quit()
	}

	async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
		if (ttlSeconds) {
			await this.client.setex(key, ttlSeconds, value)
		} else {
			await this.client.set(key, value)
		}
	}

	async get(key: string): Promise<string | null> {
		return this.client.get(key)
	}

	async delete(key: string): Promise<void> {
		await this.client.del(key)
	}

	async exists(key: string): Promise<boolean> {
		const result = await this.client.exists(key)
		return result === 1
	}

	async setWithExpiry(key: string, value: string, expirySeconds: number): Promise<void> {
		await this.client.setex(key, expirySeconds, value)
	}

	/** All fields of a hash; an empty object when the key does not exist. */
	async getHash(key: string): Promise<Record<string, string>> {
		return this.client.hgetall(key)
	}

	/**
	 * Writes the given hash fields (leaving any other field untouched) and (re)sets the
	 * key's TTL, both in one MULTI so a hash is never left behind without an expiry.
	 */
	async setHashWithExpiry(
		key: string,
		fields: Record<string, string>,
		expirySeconds: number,
	): Promise<void> {
		const results = await this.client.multi().hset(key, fields).expire(key, expirySeconds).exec()
		const failure = results?.find(([error]) => error)?.[0]
		if (!results || failure) {
			throw failure ?? new Error('Redis transaction was discarded')
		}
	}

	/** Runs a Lua script atomically. `keys` get the configured key prefix; `args` do not. */
	async evalScript(script: string, keys: string[], args: string[]): Promise<unknown> {
		return this.client.eval(script, keys.length, ...keys, ...args)
	}

	/**
	 * Best-effort mutual exclusion (single Redis node): SET NX PX with a random token.
	 * Returns the token when acquired, null when someone else holds the lock. The TTL
	 * bounds how long a crashed holder can block others.
	 */
	async acquireLock(key: string, ttlMs: number): Promise<string | null> {
		const token = randomUUID()
		const result = await this.client.set(key, token, 'PX', ttlMs, 'NX')
		return result === 'OK' ? token : null
	}

	/** Whether the lock is still held with this token (it may have expired by TTL). */
	async isLockHeld(key: string, token: string): Promise<boolean> {
		return (await this.client.get(key)) === token
	}

	/**
	 * Releases the lock only if it's still ours (compare-and-delete), so a holder whose
	 * TTL expired can't delete a lock that another request has since acquired.
	 */
	async releaseLock(key: string, token: string): Promise<boolean> {
		const deleted = await this.client.eval(RELEASE_LOCK_SCRIPT, 1, key, token)
		return deleted === 1
	}
}

const RELEASE_LOCK_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
	return redis.call("del", KEYS[1])
else
	return 0
end`
