import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import request from 'supertest'
import type { PrismaService } from '../src/shared/prisma/prisma.service'
import { createE2EApp, seedTestSeller } from './helpers/e2e'

describe('Stock Movements (e2e)', () => {
	let app: NestFastifyApplication
	let prisma: PrismaService

	beforeEach(async () => {
		;({ app, prisma } = await createE2EApp())
		await seedTestSeller(prisma)
	})

	afterEach(async () => {
		await prisma.stock_movement.deleteMany()
		await prisma.store_stock.deleteMany()
		await prisma.product.deleteMany()
		await app.close()
	})

	const createProduct = async (name: string) => {
		const payload = {
			name,
			description: 'Desc',
			sku: `SKU-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
			category: 'Category',
			brand: 'Brand',
			unit: 'un',
			specifications: { imported: false, moreinfo: '...' },
			images: ['https://example.com/img.png'],
			active: true,
		}
		const res = await request(app.getHttpServer()).post('/products').send(payload).expect(201)
		return res.body
	}

	it('should create IN and OUT movements and update store stock', async () => {
		const product = await createProduct('Stock Test')

		const inRes = await request(app.getHttpServer())
			.post('/stock-movements')
			.send({
				movement_type: 'in',
				reference_type: 'purchase',
				reference_id: 1,
				product_id: product.id,
				quantity: 5,
			})
			.expect(201)
		expect(inRes.body.product_id).toBe(product.id)

		const outRes = await request(app.getHttpServer())
			.post('/stock-movements')
			.send({
				movement_type: 'out',
				reference_type: 'sale',
				reference_id: 2,
				product_id: product.id,
				quantity: 3,
			})
			.expect(201)
		expect(outRes.body.product_id).toBe(product.id)

		const stockRes = await request(app.getHttpServer())
			.get(`/store-stock/${product.id}`)
			.expect(200)
		expect(stockRes.body.quantity).toBe(2)

		const listRes = await request(app.getHttpServer())
			.get(`/stock-movements/product/${product.id}`)
			.expect(200)
		expect(Array.isArray(listRes.body)).toBe(true)
		expect(listRes.body.length).toBe(2)
	})

	it('should reject OUT movement when insufficient stock', async () => {
		const product = await createProduct('Stock Fail')

		await request(app.getHttpServer())
			.post('/stock-movements')
			.send({
				movement_type: 'out',
				reference_type: 'sale',
				reference_id: 99,
				product_id: product.id,
				quantity: 1,
			})
			.expect(400)
	})
})
