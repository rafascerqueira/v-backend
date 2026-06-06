import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import request from 'supertest'
import { createE2EApp } from './helpers/e2e'

describe('AppController (e2e)', () => {
	let app: NestFastifyApplication

	beforeEach(async () => {
		;({ app } = await createE2EApp())
	})

	afterEach(async () => {
		await app.close()
	})

	it('/ (GET)', () => {
		return request(app.getHttpServer()).get('/').expect(200).expect('Hello World!')
	})
})
