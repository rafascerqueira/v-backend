import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import request from 'supertest'
import type { PrismaService } from '../src/shared/prisma/prisma.service'
import { createE2EApp, seedTestSeller, TEST_SELLER } from './helpers/e2e'

/**
 * Subscriptions (e2e): the dunning warning must reach the client, checkout input is
 * validated at the boundary, an existing subscription blocks a second checkout, and
 * the DB guarantees one row per Stripe subscription.
 */
describe('Subscriptions (e2e)', () => {
	let app: NestFastifyApplication
	let prisma: PrismaService

	const pastDueRow = (providerId: string) => ({
		account_id: TEST_SELLER.id,
		plan_type: 'pro' as const,
		status: 'past_due' as const,
		payment_provider: 'stripe',
		provider_subscription_id: providerId,
		provider_customer_id: 'cus_e2e',
		current_period_start: new Date('2026-07-01T00:00:00Z'),
		current_period_end: new Date('2026-08-01T00:00:00Z'),
	})

	beforeEach(async () => {
		;({ app, prisma } = await createE2EApp({ planType: 'pro' }))
		await seedTestSeller(prisma)
		await prisma.subscription.deleteMany({ where: { account_id: TEST_SELLER.id } })
		await prisma.account.update({ where: { id: TEST_SELLER.id }, data: { plan_type: 'pro' } })
	})

	afterEach(async () => {
		await prisma.subscription.deleteMany({ where: { account_id: TEST_SELLER.id } })
		await prisma.account.update({
			where: { id: TEST_SELLER.id },
			data: { plan_type: TEST_SELLER.plan_type },
		})
		await app.close()
	})

	it('GET /subscriptions/info returns a past_due subscription (dunning warning)', async () => {
		await prisma.subscription.create({ data: pastDueRow('sub_e2e_past_due') })

		const res = await request(app.getHttpServer()).get('/subscriptions/info').expect(200)

		expect(res.body.plan).toBe('pro')
		expect(res.body.subscription).toMatchObject({
			status: 'past_due',
			plan_type: 'pro',
			provider_subscription_id: 'sub_e2e_past_due',
		})
	})

	it.each([
		['[pro]'],
		['["pro"]'],
		['free'],
		['__proto__'],
	])('POST /subscriptions/checkout rejects planId %p with 400', async (planId) => {
		await request(app.getHttpServer()).post('/subscriptions/checkout').send({ planId }).expect(400)
	})

	it('POST /subscriptions/checkout returns 409 when the account already has a subscription', async () => {
		await prisma.subscription.create({ data: pastDueRow('sub_e2e_blocking') })

		const res = await request(app.getHttpServer())
			.post('/subscriptions/checkout')
			.send({ planId: 'pro' })
			.expect(409)

		expect(res.body.message).toContain('Gerenciar assinatura')
		// Machine-readable reason (forwarded by GlobalExceptionFilter) the UI branches on.
		expect(res.body.code).toBe('SUBSCRIPTION_EXISTS')
	})

	it('the DB rejects a second row for the same provider subscription id', async () => {
		await prisma.subscription.create({ data: pastDueRow('sub_e2e_unique') })

		await expect(
			prisma.subscription.create({ data: pastDueRow('sub_e2e_unique') }),
		).rejects.toMatchObject({ code: 'P2002' })
	})
})
