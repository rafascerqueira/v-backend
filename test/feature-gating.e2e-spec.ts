import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import request from 'supertest'
import type { PrismaService } from '../src/shared/prisma/prisma.service'
import { createE2EApp, seedTestSeller } from './helpers/e2e'

/**
 * Tier 2 feature gating (end-to-end). The FeatureGuard must block free sellers
 * from Pro-only endpoints with a 403 (not silently allow), while paid plans pass
 * through. The token plan is overridden per-app via the e2e harness.
 */
describe('Feature gating (e2e)', () => {
	describe('free plan', () => {
		let app: NestFastifyApplication
		let prisma: PrismaService

		beforeEach(async () => {
			;({ app, prisma } = await createE2EApp({ planType: 'free' }))
			await seedTestSeller(prisma)
		})

		afterEach(async () => {
			await app.close()
		})

		it('blocks reports with 403', async () => {
			await request(app.getHttpServer()).get('/reports?period=month').expect(403)
		})

		it('blocks data export with 403', async () => {
			await request(app.getHttpServer()).get('/export/orders?format=excel').expect(403)
		})
	})

	describe('enterprise plan', () => {
		let app: NestFastifyApplication
		let prisma: PrismaService

		beforeEach(async () => {
			;({ app, prisma } = await createE2EApp({ planType: 'enterprise' }))
			await seedTestSeller(prisma)
		})

		afterEach(async () => {
			await app.close()
		})

		it('allows reports', async () => {
			await request(app.getHttpServer()).get('/reports?period=month').expect(200)
		})

		it('allows data export', async () => {
			await request(app.getHttpServer()).get('/export/orders?format=excel').expect(200)
		})
	})
})
