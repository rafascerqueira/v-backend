import { Test, type TestingModule } from '@nestjs/testing'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import { FastifyAdapter } from '@nestjs/platform-fastify'
import * as request from 'supertest'
import { AppModule } from '../src/app.module'
import { PrismaService } from '../src/shared/prisma/prisma.service'

describe('Customers (e2e)', () => {
	let app: NestFastifyApplication
	let prisma: PrismaService

	// Global DB setup/teardown is handled by Jest globalSetup/globalTeardown

	beforeEach(async () => {
		const moduleFixture: TestingModule = await Test.createTestingModule({
			imports: [AppModule],
		}).compile()

		app = moduleFixture.createNestApplication<NestFastifyApplication>(
			new FastifyAdapter(),
		)
		prisma = app.get<PrismaService>(PrismaService)

		const { ZodExceptionFilter } = await import(
			'../src/shared/filters/zod-exception.filter'
		)
		const { GlobalExceptionFilter } = await import(
			'../src/shared/filters/global-exception.filter'
		)

		app.useGlobalFilters(new GlobalExceptionFilter(), new ZodExceptionFilter())

		await app.init()
		await app.getHttpAdapter().getInstance().ready()
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
			return request(app.getHttpServer())
				.post('/customers')
				.send(validCustomerData)
				.expect(201)
		})

		it('should reject duplicate email', async () => {
			await request(app.getHttpServer())
				.post('/customers')
				.send(validCustomerData)
				.expect(201)

			const duplicateData = {
				...validCustomerData,
				phone: '11888888888',
				document: '98765432101',
			}

			return request(app.getHttpServer())
				.post('/customers')
				.send(duplicateData)
				.expect(409)
		})

		it('should reject duplicate phone', async () => {
			await request(app.getHttpServer())
				.post('/customers')
				.send(validCustomerData)
				.expect(201)

			const duplicateData = {
				...validCustomerData,
				email: 'outro@example.com',
				document: '98765432101',
			}

			return request(app.getHttpServer())
				.post('/customers')
				.send(duplicateData)
				.expect(409)
		})

		it('should reject invalid email format', () => {
			const invalidData = {
				...validCustomerData,
				email: 'invalid-email',
			}

			return request(app.getHttpServer())
				.post('/customers')
				.send(invalidData)
				.expect(400)
		})

		it('should reject invalid phone format', () => {
			const invalidData = {
				...validCustomerData,
				phone: '123',
			}

			return request(app.getHttpServer())
				.post('/customers')
				.send(invalidData)
				.expect(400)
		})

		it('should reject invalid state code', () => {
			const invalidData = {
				...validCustomerData,
				state: 'XXX',
			}

			return request(app.getHttpServer())
				.post('/customers')
				.send(invalidData)
				.expect(400)
		})
	})

	describe('/customers (GET)', () => {
		it('should list all customers', async () => {
			const customer1 = {
				name: 'Customer 1',
				email: 'customer1@example.com',
				phone: '11111111111',
				document: '11111111111',
				address: { street: 'Rua 1' },
				city: 'City 1',
				state: 'SP',
				zip_code: '11111-111',
			}

			const customer2 = {
				name: 'Customer 2',
				email: 'customer2@example.com',
				phone: '22222222222',
				document: '22222222222',
				address: { street: 'Rua 2' },
				city: 'City 2',
				state: 'RJ',
				zip_code: '22222-222',
			}

			await prisma.customer.createMany({
				data: [customer1, customer2],
			})

			const response = await request(app.getHttpServer())
				.get('/customers')
				.expect(200)

			expect(response.body).toHaveLength(2)
			expect(response.body[0]).toHaveProperty('name')
			expect(response.body[0]).toHaveProperty('email')
		})

		it('should return empty array when no customers exist', async () => {
			const response = await request(app.getHttpServer())
				.get('/customers')
				.expect(200)

			expect(response.body).toEqual([])
		})
	})

	describe('/customers/:id (GET)', () => {
		it('should get customer by id', async () => {
			const customer = await prisma.customer.create({
				data: {
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
			return request(app.getHttpServer())
				.get('/customers/non-existent-id')
				.expect(404)
		})
	})
})
