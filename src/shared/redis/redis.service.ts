import { Injectable, OnModuleDestroy } from '@nestjs/common'
import Redis, { type Redis as RedisClient } from 'ioredis'

@Injectable()
export class RedisService implements OnModuleDestroy {
	private readonly client: RedisClient

	constructor() {
		this.client = new Redis({
			host: process.env.REDIS_HOST || 'localhost',
			port: parseInt(process.env.REDIS_PORT || '6379'),
			password: process.env.REDIS_PASSWORD || undefined,
			db: parseInt(process.env.REDIS_DB || '0'),
			keyPrefix: process.env.REDIS_KEY_PREFIX || 'vendinhas:',
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
}
