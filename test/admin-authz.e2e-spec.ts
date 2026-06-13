import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import request from 'supertest'
import type { PrismaService } from '../src/shared/prisma/prisma.service'
import { createE2EApp, seedTestSeller, TEST_SELLER } from './helpers/e2e'

// End-to-end proof that RolesGuard enforces the admin role against the DB (not the
// token claim): the e2e tenant is a seller, so every /admin route must 403 — even
// though the request is authenticated. Elevating the account's DB role flips access.
describe('Admin authorization (e2e)', () => {
	let app: NestFastifyApplication
	let prisma: PrismaService

	beforeEach(async () => {
		;({ app, prisma } = await createE2EApp())
		await seedTestSeller(prisma) // role: seller
	})

	afterEach(async () => {
		// Reset the role so an elevated test never leaks into the next one.
		await prisma.account
			.update({ where: { id: TEST_SELLER.id }, data: { role: 'seller' } })
			.catch(() => undefined)
		await app.close()
	})

	describe('as an authenticated non-admin seller', () => {
		it.each([
			'/admin/stats',
			'/admin/accounts',
			'/admin/active-users',
			'/admin/logs',
		])('rejects GET %s with 403', async (path) => {
			await request(app.getHttpServer()).get(path).expect(403)
		})

		it('rejects admin mutations (DELETE /admin/accounts/:id) with 403', async () => {
			await request(app.getHttpServer()).delete(`/admin/accounts/${TEST_SELLER.id}`).expect(403)
		})
	})

	describe('as an admin (DB role elevated)', () => {
		beforeEach(async () => {
			await prisma.account.update({ where: { id: TEST_SELLER.id }, data: { role: 'admin' } })
		})

		it('allows GET /admin/stats', async () => {
			const res = await request(app.getHttpServer()).get('/admin/stats').expect(200)
			expect(res.body).toHaveProperty('accounts')
		})
	})
})
