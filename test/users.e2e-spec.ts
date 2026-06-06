import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import request from 'supertest'
import type { PrismaService } from '../src/shared/prisma/prisma.service'
import { createE2EApp } from './helpers/e2e'

describe('Users (e2e)', () => {
	let app: NestFastifyApplication
	let prisma: PrismaService

	beforeEach(async () => {
		;({ app, prisma } = await createE2EApp({ realAuth: true }))
	})

	afterEach(async () => {
		await prisma.account.deleteMany()
		await app.close()
	})

	describe('/auth/register (POST)', () => {
		const validAccountData = {
			name: 'John Doe',
			email: 'john@example.com',
			password: 'Password123',
		}

		it('should create account successfully', () => {
			return request(app.getHttpServer())
				.post('/auth/register')
				.send(validAccountData)
				.expect(201)
		})

		it('should reject duplicate email', async () => {
			await request(app.getHttpServer()).post('/auth/register').send(validAccountData).expect(201)

			return request(app.getHttpServer()).post('/auth/register').send(validAccountData).expect(400)
		})

		it('should reject invalid email format', () => {
			return request(app.getHttpServer())
				.post('/auth/register')
				.send({ ...validAccountData, email: 'invalid-email' })
				.expect(400)
		})

		it('should reject short password', () => {
			return request(app.getHttpServer())
				.post('/auth/register')
				.send({ ...validAccountData, password: '123' })
				.expect(400)
		})

		it('should reject missing required fields', () => {
			return request(app.getHttpServer())
				.post('/auth/register')
				.send({ name: 'John Doe' })
				.expect(400)
		})
	})
})
