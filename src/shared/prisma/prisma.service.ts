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
		super({ adapter })
	}

	async onModuleInit() {
		return this.$connect()
	}

	async onModuleDestroy() {
		return this.$disconnect()
	}
}
