import cookie from '@fastify/cookie'
import multipart from '@fastify/multipart'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { Test, type TestingModule } from '@nestjs/testing'
import { ThrottlerStorage } from '@nestjs/throttler'
import { AppModule } from '../../src/app.module'
import { TokenService } from '../../src/modules/auth/services/token.service'
import { TokenBlacklistService } from '../../src/modules/auth/services/token-blacklist.service'
import { GlobalExceptionFilter } from '../../src/shared/filters/global-exception.filter'
import { ZodExceptionFilter } from '../../src/shared/filters/zod-exception.filter'
import { PrismaService } from '../../src/shared/prisma/prisma.service'

/**
 * Fixed tenant used by authenticated e2e suites. Seeded with `seedTestSeller`
 * so the FK from customers/products/orders (-> accounts.id) is satisfied, and
 * returned as the decoded token so TenantContext scopes every repository to it.
 * enterprise plan => PlanLimitsGuard never trips on create endpoints.
 */
export const TEST_SELLER = {
	id: 'e2e-seller-000000000000001',
	name: 'E2E Seller',
	email: 'e2e-seller@example.com',
	role: 'seller' as const,
	plan_type: 'enterprise' as const,
}

// `overrideGuard` does NOT replace APP_GUARD-registered global guards (JwtAuthGuard,
// ThrottlerGuard) in this Nest version, so we neutralize them at the provider level
// instead: a no-op throttler storage (never blocks) and a stubbed TokenService that
// accepts any bearer token as TEST_SELLER.
const NEVER_THROTTLE = {
	increment: async () => ({
		totalHits: 0,
		timeToExpire: 0,
		isBlocked: false,
		timeToBlockExpire: 0,
	}),
}

interface E2EAppOptions {
	/** Keep real auth (TokenService) for suites that log in / assert 401. */
	realAuth?: boolean
}

export interface E2EApp {
	app: NestFastifyApplication
	prisma: PrismaService
	module: TestingModule
}

/**
 * Boot the full application for e2e tests, mirroring main.ts (cookie, multipart,
 * filters). Throttling is always disabled. In the default (injected) mode the
 * TokenService is stubbed and an Authorization header is forced onto every
 * request, so the real JwtAuthGuard authenticates each call as TEST_SELLER
 * without a login round-trip. Pass `realAuth` to exercise the real auth flow.
 */
export async function createE2EApp(options: E2EAppOptions = {}): Promise<E2EApp> {
	const builder = Test.createTestingModule({ imports: [AppModule] })
		.overrideProvider(ThrottlerStorage)
		.useValue(NEVER_THROTTLE)

	if (!options.realAuth) {
		builder
			.overrideProvider(TokenService)
			.useValue({
				verifyAccessToken: async () => ({
					sub: TEST_SELLER.id,
					email: TEST_SELLER.email,
					role: TEST_SELLER.role,
					plan_type: TEST_SELLER.plan_type,
				}),
			})
			.overrideProvider(TokenBlacklistService)
			.useValue({ isBlacklisted: async () => false, addToBlacklist: async () => undefined })
	}

	const module = await builder.compile()

	const app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
	const instance = app.getHttpAdapter().getInstance()

	if (!options.realAuth) {
		// Bearer auth => JwtAuthGuard passes (stubbed verify) and CsrfGuard exempts.
		instance.addHook('onRequest', (req: any, _reply: any, done: () => void) => {
			if (!req.headers.authorization) req.headers.authorization = 'Bearer e2e'
			done()
		})
	}

	app.useGlobalFilters(new GlobalExceptionFilter(), new ZodExceptionFilter())
	await app.register(cookie as never, { secret: 'test-secret' })
	await app.register(multipart as never, { limits: { fileSize: 5 * 1024 * 1024 } })

	await app.init()
	await instance.ready()

	const prisma = module.get(PrismaService)
	return { app, prisma, module }
}

/** Upsert the tenant account so tenant-scoped FKs resolve. Idempotent. */
export async function seedTestSeller(prisma: PrismaService): Promise<void> {
	await prisma.account.upsert({
		where: { id: TEST_SELLER.id },
		update: {},
		create: {
			id: TEST_SELLER.id,
			name: TEST_SELLER.name,
			email: TEST_SELLER.email,
			role: TEST_SELLER.role,
			plan_type: TEST_SELLER.plan_type,
		},
	})
}
