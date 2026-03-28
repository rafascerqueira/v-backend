import { Injectable, type OnModuleDestroy } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import Redis, { type Redis as RedisClient } from 'ioredis'

@Injectable()
export class RedisService implements OnModuleDestroy {
	private readonly client: RedisClient

	constructor(private readonly configService: ConfigService) {
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
}
