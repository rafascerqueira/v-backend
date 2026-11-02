import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import request from 'supertest'
import type { PrismaService } from '../src/shared/prisma/prisma.service'
import { createE2EApp, seedTestSeller, TEST_SELLER } from './helpers/e2e'

/**
 * Phase 1C (e2e): the append-only payment ledger. Real Postgres; requests are
 * authenticated as TEST_SELLER, OTHER owns a foreign charge.
 */
describe('Billing ledger — Phase 1C (e2e)', () => {
	let app: NestFastifyApplication
	let prisma: PrismaService

	const OTHER = { id: 'e2e-seller-ledger-other', email: 'e2e-ledger-other@example.com' }
	const SELLERS = [TEST_SELLER.id, OTHER.id]
	const http = () => request(app.getHttpServer())

	const clean = async () => {
		await prisma.domainEvent.deleteMany({ where: { seller_id: { in: SELLERS } } })
		await prisma.idempotencyKey.deleteMany({ where: { seller_id: { in: SELLERS } } })
		// Entries first: the ledger FK refuses to drop charges that still have them.
		await prisma.billingPayment.deleteMany({ where: { seller_id: { in: SELLERS } } })
		await prisma.order.deleteMany({ where: { seller_id: { in: SELLERS } } })
		await prisma.sellerSequence.deleteMany({ where: { seller_id: { in: SELLERS } } })
		await prisma.product.deleteMany({ where: { seller_id: { in: SELLERS } } })
		await prisma.customer.deleteMany({ where: { seller_id: { in: SELLERS } } })
	}

	/** A per-sale dashboard order of `total` cents, so it comes with its charge. */
	const chargeOf = async (total = 10000) => {
		const product = await prisma.product.create({
			data: { seller_id: TEST_SELLER.id, name: 'Cesta básica' },
		})
		const customer = await prisma.customer.create({
			data: {
				seller_id: TEST_SELLER.id,
				name: 'Cliente Fiado',
				phone: `119${Math.floor(Math.random() * 1e8)}`.padEnd(11, '0'),
				city: 'São Paulo',
				state: 'SP',
				billing_mode: 'per_sale',
			},
		})
		const { body: order } = await http()
			.post('/orders')
			.send({
				customer_id: customer.id,
				items: [{ product_id: product.id, quantity: 1, unit_price: total }],
			})
			.expect(201)
		const billing = await prisma.billing.findFirstOrThrow({ where: { order_id: order.id } })
		return { billing, order, customer }
	}

	const pay = (billingId: number, amount: number, key?: string) => {
		const req = http().post(`/billings/${billingId}/payments`)
		if (key) req.set('Idempotency-Key', key)
		return req.send({ amount, method: 'pix' })
	}

	const stored = (id: number) => prisma.billing.findUniqueOrThrow({ where: { id } })

	beforeAll(async () => {
		;({ app, prisma } = await createE2EApp())
		await seedTestSeller(prisma)
		await prisma.account.upsert({
			where: { id: OTHER.id },
			update: {},
			create: {
				id: OTHER.id,
				name: 'Outra',
				email: OTHER.email,
				role: 'seller',
				plan_type: 'enterprise',
			},
		})
	})

	beforeEach(clean)

	afterAll(async () => {
		await clean()
		await prisma.account.delete({ where: { id: OTHER.id } }).catch(() => undefined)
		await app.close()
	})

	it('concurrent payments add up exactly (no lost update)', async () => {
		const { billing } = await chargeOf(10000)

		const responses = await Promise.all(Array.from({ length: 10 }, () => pay(billing.id, 150)))

		expect(responses.map((r) => r.status)).toEqual(Array(10).fill(201))
		expect(await stored(billing.id)).toMatchObject({ paid_amount: 1500, status: 'partial' })
		expect(await prisma.billingPayment.count({ where: { billing_id: billing.id } })).toBe(10)
	})

	it('refuses more than the open balance, and settles with exactly the balance', async () => {
		const { billing } = await chargeOf(10000)
		await pay(billing.id, 4000).expect(201)

		const over = await pay(billing.id, 6001).expect(400)
		expect(over.body.message).toContain('saldo em aberto')

		const { body } = await pay(billing.id, 6000).expect(201)
		expect(body.billing).toMatchObject({
			paid_amount: 10000,
			status: 'paid',
			payment_status: 'confirmed',
		})
		expect(body.payment).toMatchObject({ kind: 'payment', amount: 6000, method: 'pix' })
	})

	it('reverses a payment once; a reversal cannot itself be reversed', async () => {
		const { billing } = await chargeOf(10000)
		const { body: first } = await pay(billing.id, 3000).expect(201)
		await pay(billing.id, 2000).expect(201)

		const { body } = await http()
			.post(`/billings/${billing.id}/payments/${first.payment.id}/reverse`)
			.send({ reason: 'Pagamento lançado em duplicidade' })
			.expect(201)
		expect(body.reversal).toMatchObject({
			kind: 'reversal',
			amount: 3000,
			reversal_of_id: first.payment.id,
		})
		expect(body.billing.paid_amount).toBe(2000)

		const again = await http()
			.post(`/billings/${billing.id}/payments/${first.payment.id}/reverse`)
			.send({ reason: 'De novo' })
			.expect(409)
		expect(again.body.code).toBe('ALREADY_REVERSED')
		await http()
			.post(`/billings/${billing.id}/payments/${body.reversal.id}/reverse`)
			.send({ reason: 'Estorno do estorno' })
			.expect(400)

		const { body: ledger } = await http().get(`/billings/${billing.id}/payments`).expect(200)
		expect(ledger.map((e: { kind: string; amount: number }) => [e.kind, e.amount])).toEqual([
			['payment', 3000],
			['payment', 2000],
			['reversal', 3000],
		])
	})

	it('a canceled charge takes no payment but still allows giving money back', async () => {
		const { billing } = await chargeOf(10000)
		const { body: paid } = await pay(billing.id, 2500).expect(201)
		await http().patch(`/billings/${billing.id}/cancel`).expect(200)

		await pay(billing.id, 100).expect(400)
		const { body } = await http()
			.post(`/billings/${billing.id}/payments/${paid.payment.id}/reverse`)
			.send({ reason: 'Devolvido ao cliente' })
			.expect(201)
		expect(body.billing).toMatchObject({ paid_amount: 0, status: 'canceled' })
	})

	it('replays a payment sent twice with the same Idempotency-Key', async () => {
		const { billing } = await chargeOf(10000)
		const key = 'e2e-ledger-key-000001'

		const [a, b] = await Promise.all([pay(billing.id, 1000, key), pay(billing.id, 1000, key)])

		expect([a.status, b.status]).toEqual([201, 201])
		expect(a.body.payment.id).toBe(b.body.payment.id)
		expect((await stored(billing.id)).paid_amount).toBe(1000)
		const mismatch = await pay(billing.id, 999, key).expect(422)
		expect(mismatch.body.code).toBe('IDEMPOTENCY_KEY_MISMATCH')
	})

	it('records the money movement as a domain event in the same transaction', async () => {
		const { billing } = await chargeOf(10000)
		const { body } = await pay(billing.id, 1200).expect(201)

		const event = await prisma.domainEvent.findFirstOrThrow({
			where: { aggregate_type: 'billing', aggregate_id: String(billing.id) },
		})
		expect(event.event_type).toBe('billing.payment_recorded')
		expect(event.payload).toMatchObject({
			paymentId: body.payment.id,
			amount: 1200,
			paidAmount: 1200,
			totalAmount: 10000,
		})
	})

	it('translates the deprecated PATCH paid_amount into a ledger payment of the difference', async () => {
		const { billing } = await chargeOf(10000)
		await pay(billing.id, 1000).expect(201)

		await http().patch(`/billings/${billing.id}`).send({ paid_amount: 4000 }).expect(200)
		const lower = await http()
			.patch(`/billings/${billing.id}`)
			.send({ paid_amount: 500 })
			.expect(400)

		expect(lower.body.message).toContain('estorne')
		expect((await stored(billing.id)).paid_amount).toBe(4000)
		const entries = await prisma.billingPayment.findMany({
			where: { billing_id: billing.id },
			orderBy: { id: 'asc' },
		})
		expect(entries.map((e) => [e.amount, e.note])).toEqual([
			[1000, null],
			[3000, 'Registrado pela edição da cobrança'],
		])
	})

	it('never erases financial history: charge, order and customer deletes answer 409', async () => {
		const { billing, order, customer } = await chargeOf(10000)
		const { body } = await pay(billing.id, 1000).expect(201)
		// Even fully reversed, the history stays.
		await http()
			.post(`/billings/${billing.id}/payments/${body.payment.id}/reverse`)
			.send({ reason: 'Engano' })
			.expect(201)

		for (const path of [
			`/billings/${billing.id}`,
			`/orders/${order.id}`,
			`/customers/${customer.id}`,
		]) {
			const res = await http().delete(path).expect(409)
			expect(res.body.code).toBe('HAS_PAYMENTS')
		}
		expect(await prisma.billing.count({ where: { id: billing.id } })).toBe(1)
	})

	it("hides another seller's charge (404) from list, record and reverse", async () => {
		const customer = await prisma.customer.create({
			data: { seller_id: OTHER.id, name: 'Outro', phone: '11977776666', city: 'SP', state: 'SP' },
		})
		const order = await prisma.order.create({
			data: {
				seller_id: OTHER.id,
				customer_id: customer.id,
				order_number: 'PED-OTHER-1',
				total: 5000,
			},
		})
		const foreign = await prisma.billing.create({
			data: {
				order_id: order.id,
				seller_id: OTHER.id,
				billing_number: 'COB-OTHER-1',
				total_amount: 5000,
			},
		})
		const entry = await prisma.billingPayment.create({
			data: {
				billing_id: foreign.id,
				seller_id: OTHER.id,
				kind: 'payment',
				amount: 100,
				method: 'cash',
				paid_at: new Date(),
			},
		})

		await http().get(`/billings/${foreign.id}/payments`).expect(404)
		await pay(foreign.id, 100).expect(404)
		await http()
			.post(`/billings/${foreign.id}/payments/${entry.id}/reverse`)
			.send({ reason: 'Tentativa' })
			.expect(404)
		expect(await prisma.billingPayment.count({ where: { billing_id: foreign.id } })).toBe(1)
	})
})
