import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@/generated/prisma/client'

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
	constructor() {
		const connectionString = process.env.DATABASE_URL
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
