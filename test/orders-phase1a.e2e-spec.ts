import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import type { TestingModule } from '@nestjs/testing'
import request from 'supertest'
import type { PrismaService } from '../src/shared/prisma/prisma.service'
import {
	CATALOG_REPOSITORY,
	type CatalogRepository,
} from '../src/shared/repositories/catalog.repository'
import { createE2EApp, seedTestSeller, TEST_SELLER } from './helpers/e2e'

/**
 * Phase 1A (e2e): server-side numbering, Idempotency-Key, the single order path for
 * dashboard and storefront, per-seller billing numbers, storefront tracking tokens,
 * the order timeline and the HAS_PAYMENTS guard. Real Postgres + Redis; requests
 * are authenticated as TEST_SELLER. OTHER owns the second store.
 */
describe('Orders — Phase 1A (e2e)', () => {
	let app: NestFastifyApplication
	let prisma: PrismaService
	let module: TestingModule

	const SHOP = 'p1a-shop'
	const OTHER = {
		id: 'e2e-seller-p1a-other',
		email: 'e2e-p1a-other@example.com',
		slug: 'p1a-other',
	}
	const SELLERS = [TEST_SELLER.id, OTHER.id]

	const http = () => request(app.getHttpServer())

	const waitFor = async (condition: () => Promise<boolean>, timeoutMs = 10_000) => {
		const deadline = Date.now() + timeoutMs
		while (!(await condition())) {
			if (Date.now() > deadline) throw new Error('Timed out waiting for the condition')
			await new Promise((resolve) => setTimeout(resolve, 100))
		}
	}

	const seedProduct = async (
		sellerId: string,
		opts: { stock?: number; price?: number; allowOversell?: boolean } = {},
	) => {
		const product = await prisma.product.create({
			data: {
				seller_id: sellerId,
				name: 'Bolo de cenoura',
				allow_oversell: opts.allowOversell ?? false,
			},
		})
		await prisma.product_price.create({
			data: { product_id: product.id, price: opts.price ?? 1500 },
		})
		if (opts.stock !== undefined) {
			await prisma.store_stock.create({
				data: { seller_id: sellerId, product_id: product.id, quantity: opts.stock },
			})
		}
		return product
	}

	const seedCustomer = (sellerId: string, billingMode: 'per_sale' | 'monthly' = 'monthly') =>
		prisma.customer.create({
			data: {
				seller_id: sellerId,
				name: 'Cliente E2E',
				phone: `119${Math.floor(Math.random() * 1e8)}`.padEnd(11, '0'),
				city: 'São Paulo',
				state: 'SP',
				billing_mode: billingMode,
			},
		})

	const storefrontOrder = (slug: string, productId: number, quantity = 1) =>
		http()
			.post(`/catalog/loja/${slug}/orders`)
			.send({
				customer: { name: 'Maria Cliente', phone: '11988887777', city: 'São Paulo', state: 'SP' },
				items: [{ product_id: productId, quantity }],
			})

	const stockOf = async (productId: number) =>
		(await prisma.store_stock.findUniqueOrThrow({ where: { product_id: productId } })).quantity

	const clean = async () => {
		await prisma.domainEvent.deleteMany({ where: { seller_id: { in: SELLERS } } })
		await prisma.notification.deleteMany({ where: { user_id: { in: SELLERS } } })
		await prisma.idempotencyKey.deleteMany({ where: { seller_id: { in: SELLERS } } })
		await prisma.sellerSequence.deleteMany({ where: { seller_id: { in: SELLERS } } })
		await prisma.order.deleteMany({ where: { seller_id: { in: SELLERS } } })
		await prisma.store_stock.deleteMany({ where: { seller_id: { in: SELLERS } } })
		await prisma.product.deleteMany({ where: { seller_id: { in: SELLERS } } })
		await prisma.customer.deleteMany({ where: { seller_id: { in: SELLERS } } })
	}

	beforeAll(async () => {
		;({ app, prisma, module } = await createE2EApp())
		await seedTestSeller(prisma)
		await prisma.account.update({ where: { id: TEST_SELLER.id }, data: { store_slug: SHOP } })
		await prisma.account.upsert({
			where: { id: OTHER.id },
			update: { store_slug: OTHER.slug },
			create: {
				id: OTHER.id,
				name: 'Outra Loja',
				email: OTHER.email,
				role: 'seller',
				plan_type: 'enterprise',
				store_slug: OTHER.slug,
			},
		})
	})

	beforeEach(clean)

	afterAll(async () => {
		await clean()
		await prisma.account.delete({ where: { id: OTHER.id } }).catch(() => undefined)
		await prisma.account.update({ where: { id: TEST_SELLER.id }, data: { store_slug: null } })
		await app.close()
	})

	describe('numbering', () => {
		it('numbers dashboard orders per seller, contiguous under concurrency, ignoring client numbers', async () => {
			const product = await seedProduct(TEST_SELLER.id, { stock: 100 })
			const customer = await seedCustomer(TEST_SELLER.id)

			const responses = await Promise.all(
				Array.from({ length: 5 }, (_, i) =>
					http()
						.post('/orders')
						.send({
							customer_id: customer.id,
							order_number: `PED-CLIENT-${i}`,
							items: [{ product_id: product.id, quantity: 1, unit_price: 1500 }],
						}),
				),
			)

			expect(responses.map((r) => r.status)).toEqual([201, 201, 201, 201, 201])
			const numbers = responses.map((r) => r.body.order_number).sort()
			expect(numbers).toEqual([
				'PED-000001',
				'PED-000002',
				'PED-000003',
				'PED-000004',
				'PED-000005',
			])
			expect(await stockOf(product.id)).toBe(95)
		})

		it('gives two sellers the same COB-000001 without colliding (unique per seller)', async () => {
			const mine = await seedProduct(TEST_SELLER.id, { stock: 10 })
			const theirs = await seedProduct(OTHER.id, { stock: 10 })
			const customer = await seedCustomer(TEST_SELLER.id, 'per_sale')

			await http()
				.post('/orders')
				.send({
					customer_id: customer.id,
					items: [{ product_id: mine.id, quantity: 1, unit_price: 1500 }],
				})
				.expect(201)
			// New storefront customers default to per_sale billing.
			await storefrontOrder(OTHER.slug, theirs.id).expect(201)

			const billings = await prisma.billing.findMany({
				where: { seller_id: { in: SELLERS } },
				select: { seller_id: true, billing_number: true, total_amount: true },
				orderBy: { seller_id: 'asc' },
			})
			expect(billings).toEqual(
				expect.arrayContaining([
					{ seller_id: TEST_SELLER.id, billing_number: 'COB-000001', total_amount: 1500 },
					{ seller_id: OTHER.id, billing_number: 'COB-000001', total_amount: 1500 },
				]),
			)
		})
	})

	describe('Idempotency-Key', () => {
		it('10 parallel POST /orders with the same key create exactly one order', async () => {
			const product = await seedProduct(TEST_SELLER.id, { stock: 50 })
			const customer = await seedCustomer(TEST_SELLER.id)
			const body = {
				customer_id: customer.id,
				items: [{ product_id: product.id, quantity: 2, unit_price: 1500 }],
			}

			const responses = await Promise.all(
				Array.from({ length: 10 }, () =>
					http().post('/orders').set('Idempotency-Key', 'e2e-same-key-00000001').send(body),
				),
			)

			expect(responses.map((r) => r.status)).toEqual(Array(10).fill(201))
			expect(new Set(responses.map((r) => r.body.id)).size).toBe(1)
			expect(await prisma.order.count({ where: { seller_id: TEST_SELLER.id } })).toBe(1)
			expect(await stockOf(product.id)).toBe(48)
			expect(
				await prisma.domainEvent.count({
					where: { seller_id: TEST_SELLER.id, event_type: 'order.created' },
				}),
			).toBe(1)
		})

		it('answers 422 IDEMPOTENCY_KEY_MISMATCH when the key is reused with another body', async () => {
			const product = await seedProduct(TEST_SELLER.id, { stock: 50 })
			const customer = await seedCustomer(TEST_SELLER.id)
			const order = (quantity: number) =>
				http()
					.post('/orders')
					.set('Idempotency-Key', 'e2e-reused-key-0000001')
					.send({
						customer_id: customer.id,
						items: [{ product_id: product.id, quantity, unit_price: 1500 }],
					})

			await order(1).expect(201)
			const res = await order(3).expect(422)

			expect(res.body.code).toBe('IDEMPOTENCY_KEY_MISMATCH')
			expect(await prisma.order.count({ where: { seller_id: TEST_SELLER.id } })).toBe(1)
		})

		it('rejects a malformed key with 400', async () => {
			await http().post('/orders').set('Idempotency-Key', 'not valid!').send({}).expect(400)
			// Too short: storefront keys share a namespace per store, so they must not collide.
			await http().post('/orders').set('Idempotency-Key', 'short-key').send({}).expect(400)
		})
	})

	describe('storefront orders', () => {
		it('go through the same path: stock, per-sale charge, event and a tracking token', async () => {
			const product = await seedProduct(TEST_SELLER.id, { stock: 5, price: 2490 })

			const res = await storefrontOrder(SHOP, product.id, 2).expect(201)

			expect(res.body).toMatchObject({ order_number: 'PED-000001', total: 4980 })
			expect(res.body.tracking_token).toMatch(/^[A-Za-z0-9_-]{22}$/)
			expect(await stockOf(product.id)).toBe(3)
			const order = await prisma.order.findFirstOrThrow({
				where: { id: res.body.id },
				include: { Billing: true },
			})
			expect(order.metadata).toMatchObject({ source: 'catalog' })
			expect(order.Billing).toEqual([
				expect.objectContaining({ billing_number: 'COB-000001', total_amount: 4980 }),
			])
			const event = await prisma.domainEvent.findFirstOrThrow({
				where: { aggregate_type: 'order', aggregate_id: String(res.body.id) },
			})
			expect(event).toMatchObject({ event_type: 'order.created', seller_id: TEST_SELLER.id })
			expect(event.payload).toMatchObject({ source: 'storefront', total: 4980 })
			// No customer PII in the stored event.
			expect(JSON.stringify(event.payload)).not.toContain('Maria')
			expect(JSON.stringify(event.payload)).not.toContain('11988887777')
		})

		it('never oversell, even a product the seller allows to oversell', async () => {
			const product = await seedProduct(TEST_SELLER.id, { stock: 1, allowOversell: true })

			const res = await storefrontOrder(SHOP, product.id, 2).expect(400)

			expect(res.body.message).toContain('Estoque insuficiente')
			expect(await prisma.order.count({ where: { seller_id: TEST_SELLER.id } })).toBe(0)
			expect(await stockOf(product.id)).toBe(1)
		})

		it('replay with the same Idempotency-Key and keep the same tracking token', async () => {
			const product = await seedProduct(TEST_SELLER.id, { stock: 5 })
			const send = () =>
				http()
					.post(`/catalog/loja/${SHOP}/orders`)
					.set('Idempotency-Key', 'e2e-storefront-key')
					.send({
						customer: { name: 'Maria Cliente', phone: '11988887777', city: 'SP', state: 'SP' },
						items: [{ product_id: product.id, quantity: 1 }],
					})

			const first = await send().expect(201)
			const second = await send().expect(201)

			expect(second.body.id).toBe(first.body.id)
			expect(second.body.tracking_token).toBe(first.body.tracking_token)
			expect(await stockOf(product.id)).toBe(4)
		})

		it('notify the seller once ("Novo pedido na loja")', async () => {
			const product = await seedProduct(TEST_SELLER.id, { stock: 5 })
			await storefrontOrder(SHOP, product.id).expect(201)

			const count = () =>
				prisma.notification.count({
					where: { user_id: TEST_SELLER.id, title: 'Novo pedido na loja' },
				})
			await waitFor(async () => (await count()) === 1)
			await new Promise((resolve) => setTimeout(resolve, 500))
			expect(await count()).toBe(1)
		})
	})

	describe('public tracking', () => {
		it('resolves the tracking token, never the guessable sequential number', async () => {
			const product = await seedProduct(TEST_SELLER.id, { stock: 5 })
			const { body } = await storefrontOrder(SHOP, product.id).expect(201)

			const tracked = await http()
				.get(`/catalog/loja/${SHOP}/orders/${body.tracking_token}/track`)
				.expect(200)
			expect(tracked.body).toMatchObject({ order_number: body.order_number, status: 'pending' })

			await http().get(`/catalog/loja/${SHOP}/orders/${body.order_number}/track`).expect(404)
			await http()
				.get(`/catalog/loja/${OTHER.slug}/orders/${body.tracking_token}/track`)
				.expect(404)
		})

		it('keeps legacy links (pre-1A random numbers) working', async () => {
			const customer = await seedCustomer(TEST_SELLER.id)
			await prisma.order.create({
				data: {
					seller_id: TEST_SELLER.id,
					customer_id: customer.id,
					order_number: 'PED-MHZ3K2AB7Q',
					total: 1000,
					metadata: { source: 'catalog' },
				},
			})

			await http().get(`/catalog/loja/${SHOP}/orders/PED-MHZ3K2AB7Q/track`).expect(200)
		})
	})

	describe('timeline and deletion', () => {
		it('GET /orders/:id/events lists the order history; another seller gets 404', async () => {
			const product = await seedProduct(TEST_SELLER.id, { stock: 5 })
			const customer = await seedCustomer(TEST_SELLER.id)
			const { body: order } = await http()
				.post('/orders')
				.send({
					customer_id: customer.id,
					items: [{ product_id: product.id, quantity: 1, unit_price: 1500 }],
				})
				.expect(201)
			await http().patch(`/orders/${order.id}/status`).send({ status: 'confirmed' }).expect(200)

			const { body: events } = await http().get(`/orders/${order.id}/events`).expect(200)
			expect(events.map((e: { event_type: string }) => e.event_type)).toEqual([
				'order.created',
				'order.status_changed',
			])
			expect(events[1].payload).toMatchObject({ from: 'pending', to: 'confirmed' })

			const foreign = await seedProduct(OTHER.id, { stock: 5 })
			const { body: theirs } = await storefrontOrder(OTHER.slug, foreign.id).expect(201)
			await http().get(`/orders/${theirs.id}/events`).expect(404)
		})

		it('refuses to delete an order whose charge has a payment (409 HAS_PAYMENTS)', async () => {
			const product = await seedProduct(TEST_SELLER.id, { stock: 5 })
			const customer = await seedCustomer(TEST_SELLER.id, 'per_sale')
			const { body: order } = await http()
				.post('/orders')
				.send({
					customer_id: customer.id,
					items: [{ product_id: product.id, quantity: 1, unit_price: 1500 }],
				})
				.expect(201)
			await prisma.billing.updateMany({ where: { order_id: order.id }, data: { paid_amount: 500 } })

			const res = await http().delete(`/orders/${order.id}`).expect(409)

			expect(res.body.code).toBe('HAS_PAYMENTS')
			expect(await prisma.order.count({ where: { id: order.id } })).toBe(1)
			expect(await stockOf(product.id)).toBe(4)
		})
	})

	describe('security review fixes', () => {
		it("never returns a customer's password hash (orders and the customer list)", async () => {
			const product = await seedProduct(TEST_SELLER.id, { stock: 5 })
			const customer = await seedCustomer(TEST_SELLER.id)
			await prisma.customer.update({
				where: { id: customer.id },
				data: { password_hash: '$argon2id$v=19$m=65536,t=3,p=4$e2e$e2e', document: '12345678901' },
			})

			const { body: order } = await http()
				.post('/orders')
				.send({
					customer_id: customer.id,
					items: [{ product_id: product.id, quantity: 1, unit_price: 1500 }],
				})
				.expect(201)
			const { body: customers } = await http().get('/customers').expect(200)

			expect(order.customer).toEqual({
				id: customer.id,
				name: customer.name,
				email: null,
				phone: customer.phone,
			})
			expect(JSON.stringify(customers)).not.toContain('argon2id')
			expect(JSON.stringify(customers)).not.toContain('password_hash')
		})

		it('still lets storefront login read the hash (explicit select beats the global omit)', async () => {
			const customer = await seedCustomer(TEST_SELLER.id)
			await prisma.customer.update({
				where: { id: customer.id },
				data: { password_hash: '$argon2id$v=19$m=65536,t=3,p=4$e2e$e2e' },
			})

			const withHash = await module
				.get<CatalogRepository>(CATALOG_REPOSITORY)
				.findCustomerWithHashById(customer.id)

			expect(withHash?.password_hash).toBe('$argon2id$v=19$m=65536,t=3,p=4$e2e$e2e')
		})

		it('echoes only the first name to the anonymous storefront caller', async () => {
			const product = await seedProduct(TEST_SELLER.id, { stock: 5 })

			const { body } = await storefrontOrder(SHOP, product.id).expect(201)

			expect(body.customer).toEqual({ firstName: 'Maria' })
		})

		it('caps an order at 100 lines', async () => {
			const product = await seedProduct(TEST_SELLER.id)

			await http()
				.post(`/catalog/loja/${SHOP}/orders`)
				.send({
					customer: { name: 'Maria Cliente', phone: '11988887777', city: 'SP', state: 'SP' },
					items: Array.from({ length: 101 }, () => ({ product_id: product.id, quantity: 1 })),
				})
				.expect(400)
			expect(await prisma.order.count({ where: { seller_id: TEST_SELLER.id } })).toBe(0)
		})
	})
})
