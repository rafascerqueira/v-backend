import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import request from 'supertest'
import type { PrismaService } from '../src/shared/prisma/prisma.service'
import { createE2EApp, seedTestSeller } from './helpers/e2e'

describe('Products (e2e)', () => {
	let app: NestFastifyApplication
	let prisma: PrismaService

	beforeEach(async () => {
		;({ app, prisma } = await createE2EApp())
		await seedTestSeller(prisma)
	})

	afterEach(async () => {
		await prisma.product.deleteMany()
		await app.close()
	})

	describe('/products (POST)', () => {
		const getValidProductData = (suffix = '') => ({
			name: `Integration Test Product ${suffix}`,
			description: 'Test Description',
			sku: `INT-TEST-${Date.now()}-${suffix}`,
			category: 'Electronics',
			brand: 'Test Brand',
			unit: 'piece',
			specifications: { imported: false, moreinfo: 'Additional info' },
			images: ['https://example.com/image1.jpg', 'https://example.com/image2.jpg'],
			active: true,
		})

		it('should create a product successfully', () => {
			return request(app.getHttpServer())
				.post('/products')
				.send(getValidProductData('001'))
				.expect(201)
		})

		it('should reject invalid product data', () => {
			const invalidData = {
				name: '',
				description: 'Test Description',
				sku: 'INVALID-TEST',
				category: 'Electronics',
				brand: 'Test Brand',
				specifications: { imported: false },
				images: ['not-a-url'],
			}

			return request(app.getHttpServer()).post('/products').send(invalidData).expect(400)
		})

		it('should reject missing required fields', () => {
			// `name` is the only required field — omit it.
			return request(app.getHttpServer())
				.post('/products')
				.send({ description: 'Missing name' })
				.expect(400)
		})
	})
})
