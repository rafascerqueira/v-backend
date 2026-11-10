import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@/generated/prisma/client'

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
	constructor(configService: ConfigService) {
		const connectionString = configService.get<string>('database.url')
		if (!connectionString) {
			throw new Error('DATABASE_URL environment variable is not set')
		}

		const adapter = new PrismaPg({ connectionString })
		// Never return a storefront customer's password hash by accident: any query
		// that returns whole Customer rows (lists, `include: { customer: true }`)
		// leaked it. The storefront auth paths that need it select it explicitly,
		// which overrides this global omit.
		super({ adapter, omit: { customer: { password_hash: true } } })
	}

	async onModuleInit() {
		return this.$connect()
	}

	async onModuleDestroy() {
		return this.$disconnect()
	}
}
