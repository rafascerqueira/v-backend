import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import request from 'supertest'
import type { PrismaService } from '../src/shared/prisma/prisma.service'
import { createE2EApp, deleteLedgerEntries, seedTestSeller, TEST_SELLER } from './helpers/e2e'

/**
 * Phase 1D (e2e): every stock change is a movement applied under the row lock with
 * an atomic increment, recorded as stock.moved; a quantity PATCH becomes an
 * adjustment movement, so the movement history always adds up to the stock.
 */
describe('Stock — Phase 1D (e2e)', () => {
	let app: NestFastifyApplication
	let prisma: PrismaService
	const http = () => request(app.getHttpServer())

	const waitFor = async (condition: () => Promise<boolean>, timeoutMs = 10_000) => {
		const deadline = Date.now() + timeoutMs
		while (!(await condition())) {
			if (Date.now() > deadline) throw new Error('Timed out waiting for the condition')
			await new Promise((resolve) => setTimeout(resolve, 100))
		}
	}

	const clean = async () => {
		const seller = { seller_id: TEST_SELLER.id }
		await prisma.domainEvent.deleteMany({ where: seller })
		await prisma.notification.deleteMany({ where: { user_id: TEST_SELLER.id } })
		await prisma.idempotencyKey.deleteMany({ where: seller })
		await deleteLedgerEntries(prisma, seller)
		await prisma.order.deleteMany({ where: seller })
		await prisma.sellerSequence.deleteMany({ where: seller })
		await prisma.stock_movement.deleteMany({ where: { product: seller } })
		await prisma.store_stock.deleteMany({ where: seller })
		await prisma.product.deleteMany({ where: seller })
		await prisma.customer.deleteMany({ where: seller })
	}

	const productWithStock = async (quantity: number, allowOversell = false) => {
		const product = await prisma.product.create({
			data: { seller_id: TEST_SELLER.id, name: 'Farinha', allow_oversell: allowOversell },
		})
		await prisma.store_stock.create({
			data: { seller_id: TEST_SELLER.id, product_id: product.id, quantity },
		})
		return product
	}

	const stockOf = async (productId: number) =>
		(await prisma.store_stock.findUniqueOrThrow({ where: { product_id: productId } })).quantity

	/** Σ movements: in − out. */
	const movementBalance = async (productId: number) => {
		const movements = await prisma.stock_movement.findMany({ where: { product_id: productId } })
		return movements.reduce(
			(acc, m) => acc + (m.movement_type === 'in' ? m.quantity : -m.quantity),
			0,
		)
	}

	const move = (productId: number, type: 'in' | 'out', quantity: number) =>
		http()
			.post('/stock-movements')
			.send({
				movement_type: type,
				reference_type: type === 'in' ? 'purchase' : 'adjustment',
				reference_id: 0,
				product_id: productId,
				quantity,
			})

	beforeAll(async () => {
		;({ app, prisma } = await createE2EApp())
		await seedTestSeller(prisma)
	})

	beforeEach(clean)

	afterAll(async () => {
		await clean()
		await app.close()
	})

	it('concurrent movements and sales never lose an update', async () => {
		const product = await productWithStock(50)
		const customer = await prisma.customer.create({
			data: {
				seller_id: TEST_SELLER.id,
				name: 'C',
				phone: '11955554444',
				city: 'SP',
				state: 'SP',
				billing_mode: 'monthly',
				billing_day: 10,
			},
		})

		const responses = await Promise.all([
			...Array.from({ length: 6 }, () => move(product.id, 'in', 1)),
			...Array.from({ length: 4 }, () =>
				http()
					.post('/orders')
					.send({
						customer_id: customer.id,
						items: [{ product_id: product.id, quantity: 2, unit_price: 500 }],
					}),
			),
		])

		expect(responses.map((r) => r.status)).toEqual(Array(10).fill(201))
		// 50 + 6 − 4×2. (10 concurrent requests: past ~12, supertest's per-request
		// ephemeral server starts resetting sockets — a harness limit, not the app's.)
		expect(await stockOf(product.id)).toBe(48)
	})

	it('a quantity PATCH becomes an adjustment movement: the history adds up to the stock', async () => {
		const product = await productWithStock(0)
		await move(product.id, 'in', 10).expect(201)

		await http().patch(`/store-stock/${product.id}`).send({ quantity: 7, min_stock: 2 }).expect(200)

		const stock = await prisma.store_stock.findUniqueOrThrow({ where: { product_id: product.id } })
		expect(stock).toMatchObject({ quantity: 7, min_stock: 2 })
		const adjustment = await prisma.stock_movement.findFirstOrThrow({
			where: { product_id: product.id, reference_type: 'adjustment' },
		})
		expect(adjustment).toMatchObject({ movement_type: 'out', quantity: 3 })
		expect(await movementBalance(product.id)).toBe(7)
	})

	it('a PATCH of settings only (or to the same quantity) records no movement', async () => {
		const product = await productWithStock(5)

		await http().patch(`/store-stock/${product.id}`).send({ min_stock: 1 }).expect(200)
		await http().patch(`/store-stock/${product.id}`).send({ quantity: 5 }).expect(200)

		expect(await prisma.stock_movement.count({ where: { product_id: product.id } })).toBe(0)
		expect(await stockOf(product.id)).toBe(5)
	})

	it('records stock.moved, and a restock covering a waiting order notifies the seller once', async () => {
		const product = await productWithStock(1, true)
		const customer = await prisma.customer.create({
			data: {
				seller_id: TEST_SELLER.id,
				name: 'C',
				phone: '11955553333',
				city: 'SP',
				state: 'SP',
				billing_mode: 'monthly',
				billing_day: 10,
			},
		})
		// Sold 3 with 1 on hand (allow_oversell): 2 units owed on a backorder.
		const { body: order } = await http()
			.post('/orders')
			.send({
				customer_id: customer.id,
				items: [{ product_id: product.id, quantity: 3, unit_price: 500 }],
			})
			.expect(201)

		await move(product.id, 'in', 5).expect(201)

		const event = await prisma.domainEvent.findFirstOrThrow({
			where: { aggregate_type: 'stock', aggregate_id: String(product.id) },
		})
		expect(event.payload).toMatchObject({
			movementType: 'in',
			quantity: 5,
			previousQuantity: -2,
			newQuantity: 3,
			fulfilled: [{ orderId: order.id, orderNumber: order.order_number, quantity: 2 }],
		})
		const covered = () =>
			prisma.notification.count({
				where: { user_id: TEST_SELLER.id, title: 'Reposição alocada a pedido' },
			})
		await waitFor(async () => (await covered()) === 1)
		await new Promise((resolve) => setTimeout(resolve, 500))
		expect(await covered()).toBe(1)
	})

	it('still refuses an out movement past the stock on hand', async () => {
		const product = await productWithStock(2)

		await move(product.id, 'out', 3).expect(400)

		expect(await stockOf(product.id)).toBe(2)
		expect(await prisma.stock_movement.count({ where: { product_id: product.id } })).toBe(0)
	})

	it('hides another seller’s product (404 on a quantity PATCH)', async () => {
		const other = 'e2e-seller-stock-other'
		await prisma.account.upsert({
			where: { id: other },
			update: {},
			create: {
				id: other,
				name: 'O',
				email: 'e2e-stock-other@example.com',
				role: 'seller',
				plan_type: 'free',
			},
		})
		const foreign = await prisma.product.create({ data: { seller_id: other, name: 'Alheio' } })
		await prisma.store_stock.create({
			data: { seller_id: other, product_id: foreign.id, quantity: 9 },
		})

		await http().patch(`/store-stock/${foreign.id}`).send({ quantity: 0 }).expect(404)

		expect(
			(await prisma.store_stock.findUniqueOrThrow({ where: { product_id: foreign.id } })).quantity,
		).toBe(9)
		await prisma.account.delete({ where: { id: other } })
	})
})
