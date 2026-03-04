import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import type { TestingModule } from '@nestjs/testing'
import { Test } from '@nestjs/testing'
import { AppModule } from '../src/app.module'
import { TokenService } from '../src/modules/auth/services/token.service'
import { TokenBlacklistService } from '../src/modules/auth/services/token-blacklist.service'
import { AuditService } from '../src/shared/audit/audit.service'
import { PrismaService } from '../src/shared/prisma/prisma.service'

export const createE2ETestApp = async (): Promise<{
	app: NestFastifyApplication
	module: TestingModule
	prisma: PrismaService
}> => {
	const moduleFixture: TestingModule = await Test.createTestingModule({
		imports: [AppModule],
	})
		.overrideProvider(TokenService)
		.useValue({
			verifyAccessToken: jest.fn(),
			generateAccessToken: jest.fn(),
		})
		.overrideProvider(TokenBlacklistService)
		.useValue({
			isBlacklisted: jest.fn(),
			addToBlacklist: jest.fn(),
		})
		.compile()

	const app = moduleFixture.createNestApplication<NestFastifyApplication>(new FastifyAdapter())

	await app.init()

	const prisma = moduleFixture.get<PrismaService>(PrismaService)

	return { app, module, prisma }
}
