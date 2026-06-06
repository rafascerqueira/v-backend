import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import request from 'supertest'
import type { PrismaService } from '../src/shared/prisma/prisma.service'
import { createE2EApp, seedTestSeller, TEST_SELLER } from './helpers/e2e'

describe('Customers (e2e)', () => {
	let app: NestFastifyApplication
	let prisma: PrismaService

	beforeEach(async () => {
		;({ app, prisma } = await createE2EApp())
		await seedTestSeller(prisma)
	})

	afterEach(async () => {
		await prisma.customer.deleteMany()
		await app.close()
	})

	describe('/customers (POST)', () => {
		const validCustomerData = {
			name: 'João Silva',
			email: 'joao@example.com',
			phone: '11999999999',
			document: '12345678901',
			address: {
				street: 'Rua A',
				number: '123',
				complement: 'Apto 101',
				neighborhood: 'Centro',
			},
			city: 'São Paulo',
			state: 'SP',
			zip_code: '01234-567',
		}

		it('should create a customer successfully', () => {
			return request(app.getHttpServer()).post('/customers').send(validCustomerData).expect(201)
		})

		it('should reject duplicate email', async () => {
			await request(app.getHttpServer()).post('/customers').send(validCustomerData).expect(201)

			const duplicateData = {
				...validCustomerData,
				phone: '11888888888',
				document: '98765432101',
			}

			return request(app.getHttpServer()).post('/customers').send(duplicateData).expect(409)
		})

		it('should reject duplicate phone', async () => {
			await request(app.getHttpServer()).post('/customers').send(validCustomerData).expect(201)

			const duplicateData = {
				...validCustomerData,
				email: 'outro@example.com',
				document: '98765432101',
			}

			return request(app.getHttpServer()).post('/customers').send(duplicateData).expect(409)
		})

		it('should reject invalid email format', () => {
			return request(app.getHttpServer())
				.post('/customers')
				.send({ ...validCustomerData, email: 'invalid-email' })
				.expect(400)
		})

		it('should reject invalid phone format', () => {
			return request(app.getHttpServer())
				.post('/customers')
				.send({ ...validCustomerData, phone: '123' })
				.expect(400)
		})

		it('should reject invalid state code', () => {
			return request(app.getHttpServer())
				.post('/customers')
				.send({ ...validCustomerData, state: 'XXX' })
				.expect(400)
		})
	})

	describe('/customers (GET)', () => {
		it('should list all customers', async () => {
			await prisma.customer.createMany({
				data: [
					{
						seller_id: TEST_SELLER.id,
						name: 'Customer 1',
						email: 'customer1@example.com',
						phone: '11111111111',
						document: '11111111111',
						address: { street: 'Rua 1' },
						city: 'City 1',
						state: 'SP',
						zip_code: '11111-111',
					},
					{
						seller_id: TEST_SELLER.id,
						name: 'Customer 2',
						email: 'customer2@example.com',
						phone: '22222222222',
						document: '22222222222',
						address: { street: 'Rua 2' },
						city: 'City 2',
						state: 'RJ',
						zip_code: '22222-222',
					},
				],
			})

			const response = await request(app.getHttpServer()).get('/customers').expect(200)

			expect(response.body.data).toHaveLength(2)
			expect(response.body.data[0]).toHaveProperty('name')
			expect(response.body.data[0]).toHaveProperty('email')
		})

		it('should return empty array when no customers exist', async () => {
			const response = await request(app.getHttpServer()).get('/customers').expect(200)

			expect(response.body.data).toEqual([])
		})
	})

	describe('/customers/:id (GET)', () => {
		it('should get customer by id', async () => {
			const customer = await prisma.customer.create({
				data: {
					seller_id: TEST_SELLER.id,
					name: 'Test Customer',
					email: 'test@example.com',
					phone: '33333333333',
					document: '33333333333',
					address: { street: 'Test Street' },
					city: 'Test City',
					state: 'SP',
					zip_code: '33333-333',
				},
			})

			const response = await request(app.getHttpServer())
				.get(`/customers/${customer.id}`)
				.expect(200)

			expect(response.body.id).toBe(customer.id)
			expect(response.body.name).toBe(customer.name)
		})

		it('should return 404 for non-existent customer', () => {
			return request(app.getHttpServer()).get('/customers/non-existent-id').expect(404)
		})
	})
})
