import {
	Injectable,
	type OnModuleDestroy,
	type OnModuleInit,
} from '@nestjs/common'
import { PrismaClient } from '@/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

@Injectable()
export class PrismaService
	extends PrismaClient
	implements OnModuleInit, OnModuleDestroy
{
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
