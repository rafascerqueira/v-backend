import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import request from 'supertest'
import type { PrismaService } from '../src/shared/prisma/prisma.service'
import { createE2EApp, seedTestSeller } from './helpers/e2e'

describe('Product Prices (e2e)', () => {
	let app: NestFastifyApplication
	let prisma: PrismaService

	beforeEach(async () => {
		;({ app, prisma } = await createE2EApp())
		await seedTestSeller(prisma)
	})

	afterEach(async () => {
		await prisma.product_price.deleteMany()
		await prisma.product.deleteMany()
		await app.close()
	})

	const createProduct = async () => {
		const payload = {
			name: `Price Test Product ${Date.now()}`,
			description: 'Test product for price e2e',
			sku: `PRICE-E2E-${Date.now()}`,
			category: 'Category',
			brand: 'Brand',
			unit: 'un',
			specifications: { imported: false },
			images: [],
			active: true,
		}

		await request(app.getHttpServer()).post('/products').send(payload).expect(201)

		return prisma.product.findFirstOrThrow({ where: { sku: payload.sku } })
	}

	it('should create, list, update and deactivate a product price', async () => {
		const product = await createProduct()

		const createBody = {
			price: 1234,
			price_type: 'sale',
			valid_from: '2025-01-01T00:00:00.000Z',
			valid_to: '2025-12-31T23:59:59.000Z',
			active: true,
		}

		const createRes = await request(app.getHttpServer())
			.post(`/products/${product.id}/prices`)
			.send(createBody)
			.expect(201)

		expect(createRes.body).toMatchObject({
			product_id: product.id,
			price: createBody.price,
			price_type: createBody.price_type,
			active: true,
		})

		const listRes = await request(app.getHttpServer())
			.get(`/products/${product.id}/prices`)
			.expect(200)

		expect(Array.isArray(listRes.body)).toBe(true)
		expect(listRes.body.length).toBeGreaterThanOrEqual(1)

		const priceId = createRes.body.id

		const updateRes = await request(app.getHttpServer())
			.patch(`/product-prices/${priceId}`)
			.send({ price: 1500, valid_to: null })
			.expect(200)

		expect(updateRes.body).toMatchObject({ id: priceId, price: 1500 })

		const deactivateRes = await request(app.getHttpServer())
			.delete(`/product-prices/${priceId}`)
			.expect(200)

		expect(deactivateRes.body).toMatchObject({ id: priceId, active: false })
	})

	it('should validate bad payload on create', async () => {
		const product = await createProduct()

		await request(app.getHttpServer())
			.post(`/products/${product.id}/prices`)
			.send({ price: -10, price_type: 'invalid' })
			.expect(400)
	})
})
