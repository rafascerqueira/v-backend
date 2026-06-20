import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import request from 'supertest'
import type { PrismaService } from '../src/shared/prisma/prisma.service'
import { createE2EApp, seedTestSeller } from './helpers/e2e'

const OTHER_SELLER = 'e2e-other-seller-00000000001'

describe('Billings (e2e)', () => {
	let app: NestFastifyApplication
	let prisma: PrismaService

	beforeEach(async () => {
		;({ app, prisma } = await createE2EApp())
		await seedTestSeller(prisma)
	})

	afterEach(async () => {
		await prisma.billing.deleteMany()
		await prisma.order_item.deleteMany()
		await prisma.order.deleteMany()
		await prisma.store_stock.deleteMany()
		await prisma.product.deleteMany()
		await prisma.customer.deleteMany()
		await prisma.account.deleteMany({ where: { id: OTHER_SELLER } })
		await app.close()
	})

	// Creates a customer + product + order belonging to the e2e tenant and returns
	// the order id, so charges can be attached through the real HTTP surface.
	async function createOrder(): Promise<number> {
		const customer = (
			await request(app.getHttpServer())
				.post('/customers')
				.send({
					name: 'John Doe',
					email: `john-${Date.now()}@example.com`,
					phone: '11999999999',
					document: '12345678901',
					address: { street: 'A', neighborhood: 'B' },
					city: 'Sao Paulo',
					state: 'SP',
					zip_code: '01234000',
				})
				.expect(201)
		).body

		const product = (
			await request(app.getHttpServer())
				.post('/products')
				.send({
					name: 'Test Product',
					sku: `SKU-${Date.now()}`,
					category: 'Cat',
					unit: 'un',
					specifications: {},
					images: [],
					active: true,
				})
				.expect(201)
		).body

		const order = (
			await request(app.getHttpServer())
				.post('/orders')
				.send({
					customer_id: customer.id,
					order_number: `ORD-${Date.now()}`,
					items: [{ product_id: product.id, quantity: 1, unit_price: 10000, discount: 0 }],
				})
				.expect(201)
		).body

		return order.id
	}

	it('creates a charge then records partial and full payment', async () => {
		const orderId = await createOrder()

		const billing = (
			await request(app.getHttpServer())
				.post(`/orders/${orderId}/billings`)
				.send({
					billing_number: `COB-${Date.now()}`,
					total_amount: 10000,
					paid_amount: 0,
					payment_method: 'cash',
					payment_status: 'pending',
					status: 'pending',
				})
				.expect(201)
		).body
		expect(billing.id).toBeDefined()

		// Partial payment — paid_amount recorded, payment_date auto-set on first payment.
		const partial = (
			await request(app.getHttpServer())
				.patch(`/billings/${billing.id}`)
				.send({ paid_amount: 4000, status: 'partial' })
				.expect(200)
		).body
		expect(partial.paid_amount).toBe(4000)
		expect(partial.status).toBe('partial')
		expect(partial.payment_date).toBeTruthy()

		// Full payment.
		const full = (
			await request(app.getHttpServer())
				.patch(`/billings/${billing.id}`)
				.send({ paid_amount: 10000, status: 'paid', payment_status: 'confirmed' })
				.expect(200)
		).body
		expect(full.paid_amount).toBe(10000)
		expect(full.status).toBe('paid')
	})

	it('rejects a payment greater than the total with 400', async () => {
		const orderId = await createOrder()
		const billing = (
			await request(app.getHttpServer())
				.post(`/orders/${orderId}/billings`)
				.send({ billing_number: `COB-${Date.now()}`, total_amount: 5000, paid_amount: 0 })
				.expect(201)
		).body

		await request(app.getHttpServer())
			.patch(`/billings/${billing.id}`)
			.send({ paid_amount: 6000 })
			.expect(400)
	})

	it('cancels (voids) a charge through the dedicated endpoint', async () => {
		const orderId = await createOrder()
		const billing = (
			await request(app.getHttpServer())
				.post(`/orders/${orderId}/billings`)
				.send({ billing_number: `COB-${Date.now()}`, total_amount: 5000, paid_amount: 0 })
				.expect(201)
		).body

		const canceled = (
			await request(app.getHttpServer()).patch(`/billings/${billing.id}/cancel`).expect(200)
		).body
		expect(canceled.status).toBe('canceled')
		expect(canceled.payment_status).toBe('canceled')
	})

	it("never exposes or mutates another seller's billing", async () => {
		// Seed a charge owned by a different seller directly in the DB.
		await prisma.account.upsert({
			where: { id: OTHER_SELLER },
			update: {},
			create: {
				id: OTHER_SELLER,
				name: 'Other Seller',
				email: `other-${Date.now()}@example.com`,
				role: 'seller',
				plan_type: 'free',
			},
		})
		const otherCustomer = await prisma.customer.create({
			data: {
				seller_id: OTHER_SELLER,
				name: 'Other Customer',
				phone: '11888888888',
				city: 'Rio',
				state: 'RJ',
			},
		})
		const otherOrder = await prisma.order.create({
			data: {
				seller_id: OTHER_SELLER,
				customer_id: otherCustomer.id,
				order_number: `ORD-O-${Date.now()}`,
				total: 1000,
			},
		})
		const otherBilling = await prisma.billing.create({
			data: {
				order_id: otherOrder.id,
				billing_number: `COB-O-${Date.now()}`,
				total_amount: 1000,
			},
		})

		// Listing as the e2e tenant must not include the other seller's charge.
		const list = (await request(app.getHttpServer()).get('/billings').expect(200)).body
		expect(list.find((b: { id: number }) => b.id === otherBilling.id)).toBeUndefined()

		// Cross-tenant update / delete must look non-existent → 404 (never a 403
		// that would leak that the billing id exists).
		await request(app.getHttpServer())
			.patch(`/billings/${otherBilling.id}`)
			.send({ paid_amount: 500 })
			.expect(404)
		await request(app.getHttpServer()).patch(`/billings/${otherBilling.id}/cancel`).expect(404)
		await request(app.getHttpServer()).delete(`/billings/${otherBilling.id}`).expect(404)
	})
})
