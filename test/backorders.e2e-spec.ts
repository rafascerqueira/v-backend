import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import request from 'supertest'
import type { PrismaService } from '../src/shared/prisma/prisma.service'
import { createE2EApp, seedTestSeller } from './helpers/e2e'

// End-to-end coverage for selling past stock (allow_oversell): the order succeeds,
// stock goes negative, a backorder is recorded, a restock fills it FIFO, and the
// invariant sum(pending owed) == max(reserved - quantity, 0) holds throughout. Also
// proves a non-oversell shortage is a 400 (the frontend pre-blocks it; this is the
// server-side guard).
describe('Backorders / oversell → restock (e2e)', () => {
	let app: NestFastifyApplication
	let prisma: PrismaService

	beforeEach(async () => {
		;({ app, prisma } = await createE2EApp())
		await seedTestSeller(prisma)
	})

	afterEach(async () => {
		await prisma.backorder.deleteMany()
		await prisma.stock_movement.deleteMany()
		await prisma.billing.deleteMany()
		await prisma.order_item.deleteMany()
		await prisma.order.deleteMany()
		await prisma.store_stock.deleteMany()
		await prisma.product.deleteMany()
		await prisma.customer.deleteMany()
		await app.close()
	})

	const createCustomer = async () => {
		const res = await request(app.getHttpServer())
			.post('/customers')
			.send({
				name: 'Cliente',
				email: `c-${Date.now()}-${Math.random()}@example.com`,
				phone: `11${Math.floor(Math.random() * 1e9)}`,
				document: `${Math.floor(Math.random() * 1e11)}`,
				address: { street: 'A' },
				city: 'Sao Paulo',
				state: 'SP',
				zip_code: '01234000',
			})
			.expect(201)
		return res.body
	}

	const createProduct = async (allowOversell: boolean) => {
		const res = await request(app.getHttpServer())
			.post('/products')
			.send({
				name: 'Camiseta',
				sku: `SKU-${Date.now()}-${Math.random()}`,
				unit: 'un',
				specifications: {},
				images: [],
				active: true,
				allow_oversell: allowOversell,
			})
			.expect(201)
		return res.body
	}

	const setStock = async (productId: number, quantity: number) => {
		await request(app.getHttpServer())
			.patch(`/store-stock/${productId}`)
			.send({ quantity })
			.expect(200)
	}

	it('oversell creates a backorder and drives stock negative; restock fills it FIFO', async () => {
		const customer = await createCustomer()
		const product = await createProduct(true)
		await setStock(product.id, 2)

		// Sell 5 with only 2 on hand → succeeds (allow_oversell), 3 owed.
		const orderRes = await request(app.getHttpServer())
			.post('/orders')
			.send({
				customer_id: customer.id,
				order_number: `ORD-${Date.now()}`,
				items: [{ product_id: product.id, quantity: 5, unit_price: 1000, discount: 0 }],
			})
			.expect(201)
		const order = orderRes.body

		// Stock went to -3; a single pending backorder for the 3 owed units.
		const stockAfterSale = await prisma.store_stock.findUnique({
			where: { product_id: product.id },
		})
		expect(stockAfterSale?.quantity).toBe(-3)

		const backorders = await prisma.backorder.findMany({ where: { product_id: product.id } })
		expect(backorders).toHaveLength(1)
		expect(backorders[0]).toMatchObject({
			order_id: order.id,
			quantity: 3,
			fulfilled_quantity: 0,
			status: 'pending',
		})
		// Invariant: pending owed == negative magnitude of stock.
		expect(backorders[0].quantity - backorders[0].fulfilled_quantity).toBe(
			Math.max(0 - (stockAfterSale?.quantity ?? 0), 0),
		)

		// Products list clamps the displayed stock and surfaces the owed summary.
		const listRes = await request(app.getHttpServer()).get('/products').expect(200)
		const listed = (listRes.body.data ?? listRes.body).find(
			(p: { id: number }) => p.id === product.id,
		)
		expect(listed.stock.quantity).toBe(-3) // raw value; the frontend clamps to 0
		expect(listed.stock.owed_quantity).toBe(3)
		expect(listed.stock.pending_orders_count).toBe(1)

		// GET /backorders exposes the breakdown for the accordion.
		const boRes = await request(app.getHttpServer())
			.get('/backorders')
			.query({ product_id: product.id, status: 'pending' })
			.expect(200)
		expect(boRes.body).toHaveLength(1)
		expect(boRes.body[0].order.order_number).toBe(order.order_number)

		// Restock 5 → covers the 3 owed (stock back to 2) and clears the backorder.
		await request(app.getHttpServer())
			.post('/stock-movements')
			.send({
				movement_type: 'in',
				reference_type: 'purchase',
				reference_id: 0,
				product_id: product.id,
				quantity: 5,
			})
			.expect(201)

		const stockAfterRestock = await prisma.store_stock.findUnique({
			where: { product_id: product.id },
		})
		expect(stockAfterRestock?.quantity).toBe(2)

		const fulfilled = await prisma.backorder.findMany({ where: { product_id: product.id } })
		expect(fulfilled[0]).toMatchObject({ fulfilled_quantity: 3, status: 'fulfilled' })

		const stillPending = await request(app.getHttpServer())
			.get('/backorders')
			.query({ product_id: product.id, status: 'pending' })
			.expect(200)
		expect(stillPending.body).toHaveLength(0)
	})

	it('a partial restock fills the oldest order first and leaves the rest pending (FIFO)', async () => {
		const customer = await createCustomer()
		const product = await createProduct(true)
		await setStock(product.id, 0)

		// Two oversold orders: first owes 2, second owes 1 (total deficit 3).
		const firstRes = await request(app.getHttpServer())
			.post('/orders')
			.send({
				customer_id: customer.id,
				order_number: `ORD-A-${Date.now()}`,
				items: [{ product_id: product.id, quantity: 2, unit_price: 1000, discount: 0 }],
			})
			.expect(201)
		await request(app.getHttpServer())
			.post('/orders')
			.send({
				customer_id: customer.id,
				order_number: `ORD-B-${Date.now()}`,
				items: [{ product_id: product.id, quantity: 1, unit_price: 1000, discount: 0 }],
			})
			.expect(201)

		// Restock only 2 → first order fully covered, second still pending.
		await request(app.getHttpServer())
			.post('/stock-movements')
			.send({
				movement_type: 'in',
				reference_type: 'purchase',
				reference_id: 0,
				product_id: product.id,
				quantity: 2,
			})
			.expect(201)

		const stock = await prisma.store_stock.findUnique({ where: { product_id: product.id } })
		expect(stock?.quantity).toBe(-1)

		const first = await prisma.backorder.findFirst({ where: { order_id: firstRes.body.id } })
		expect(first).toMatchObject({ status: 'fulfilled', fulfilled_quantity: 2 })

		const pending = await prisma.backorder.findMany({
			where: { product_id: product.id, status: 'pending' },
		})
		expect(pending).toHaveLength(1)
		// Invariant still holds: 1 unit owed == negative magnitude of stock.
		const owed = pending.reduce((sum, b) => sum + (b.quantity - b.fulfilled_quantity), 0)
		expect(owed).toBe(Math.max(0 - (stock?.quantity ?? 0), 0))
	})

	it('rejects a sale past stock when the product does not allow overselling (400)', async () => {
		const customer = await createCustomer()
		const product = await createProduct(false)
		await setStock(product.id, 1)

		await request(app.getHttpServer())
			.post('/orders')
			.send({
				customer_id: customer.id,
				order_number: `ORD-${Date.now()}`,
				items: [{ product_id: product.id, quantity: 2, unit_price: 1000, discount: 0 }],
			})
			.expect(400)

		// No order and no backorder were created; stock is untouched.
		expect(await prisma.order.count()).toBe(0)
		expect(await prisma.backorder.count()).toBe(0)
		const stock = await prisma.store_stock.findUnique({ where: { product_id: product.id } })
		expect(stock?.quantity).toBe(1)
	})
})
