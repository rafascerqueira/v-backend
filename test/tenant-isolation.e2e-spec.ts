import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import request from 'supertest'
import type { PrismaService } from '../src/shared/prisma/prisma.service'
import { createE2EApp, seedTestSeller, TEST_SELLER } from './helpers/e2e'

/**
 * Tier 0 isolation proofs (end-to-end). Every request is authenticated as
 * TEST_SELLER (see helpers/e2e). A second tenant (OTHER_SELLER) owns the rows
 * under attack, so these assert that a real HTTP call from seller A cannot
 * read or mutate seller B's data: point access to a foreign row returns the
 * existence-hiding 404 (never 403) with no underlying write, while a foreign
 * sub-collection simply reads back empty (no rows leaked).
 *
 * Covers the four critical paths committed in the Tier 0 plan:
 *   C1 — POST /suppliers/debts/:debtId/pay against another seller's debt
 *   H1 — POST /orders with another seller's product_id (must not drain stock)
 *   H4 — POST /catalog/loja/:slug/orders with a product from a different store
 */
describe('Tenant isolation (e2e)', () => {
	let app: NestFastifyApplication
	let prisma: PrismaService

	const OTHER_SELLER = {
		id: 'e2e-seller-000000000000002',
		name: 'Other Seller',
		email: 'e2e-other@example.com',
		store_slug: 'other-shop',
	}
	const TEST_SELLER_SLUG = 'my-shop'

	beforeEach(async () => {
		;({ app, prisma } = await createE2EApp())
		await seedTestSeller(prisma)
		// Give the authenticated tenant a storefront slug so the public checkout
		// path resolves a real store for it.
		await prisma.account.update({
			where: { id: TEST_SELLER.id },
			data: { store_slug: TEST_SELLER_SLUG },
		})
		await prisma.account.create({
			data: {
				id: OTHER_SELLER.id,
				name: OTHER_SELLER.name,
				email: OTHER_SELLER.email,
				role: 'seller',
				plan_type: 'enterprise',
				store_slug: OTHER_SELLER.store_slug,
			},
		})
	})

	afterEach(async () => {
		await prisma.supplier_debt.deleteMany()
		await prisma.supplier.deleteMany()
		await prisma.store_stock.deleteMany()
		await prisma.order_item.deleteMany()
		await prisma.order.deleteMany()
		await prisma.product.deleteMany()
		await prisma.customer.deleteMany()
		await prisma.account.delete({ where: { id: OTHER_SELLER.id } }).catch(() => undefined)
		await prisma.account.update({
			where: { id: TEST_SELLER.id },
			data: { store_slug: null },
		})
		await app.close()
	})

	describe('C1 — supplier debt payment cross-tenant', () => {
		it("returns 404 and does not touch another seller's debt", async () => {
			const supplier = await prisma.supplier.create({
				data: { seller_id: OTHER_SELLER.id, name: 'Fornecedor B' },
			})
			const debt = await prisma.supplier_debt.create({
				data: {
					supplier_id: supplier.id,
					amount: 10000,
					paid_amount: 0,
					description: 'Dívida do fornecedor B',
				},
			})

			await request(app.getHttpServer())
				.post(`/suppliers/debts/${debt.id}/pay`)
				.send({ amount: 5000 })
				.expect(404)

			const after = await prisma.supplier_debt.findUnique({ where: { id: debt.id } })
			expect(after?.paid_amount).toBe(0)
			expect(after?.status).toBe('pending')
		})

		it("does not leak another seller's supplier debts (empty list)", async () => {
			const supplier = await prisma.supplier.create({
				data: { seller_id: OTHER_SELLER.id, name: 'Fornecedor B' },
			})
			await prisma.supplier_debt.create({
				data: {
					supplier_id: supplier.id,
					amount: 7000,
					paid_amount: 0,
					description: 'Dívida oculta',
				},
			})

			// Sub-collection scoped by supplier ownership: seller A sees an empty
			// list, indistinguishable from an owned supplier with no debts.
			const res = await request(app.getHttpServer())
				.get(`/suppliers/${supplier.id}/debts`)
				.expect(200)
			expect(res.body).toEqual([])
		})
	})

	describe('H1 — order with a foreign product', () => {
		it("returns 404 and does not decrement another seller's stock", async () => {
			const foreignProduct = await prisma.product.create({
				data: { seller_id: OTHER_SELLER.id, name: 'Produto B' },
			})
			await prisma.store_stock.create({
				data: { seller_id: OTHER_SELLER.id, product_id: foreignProduct.id, quantity: 50 },
			})
			const customer = await prisma.customer.create({
				data: {
					seller_id: TEST_SELLER.id,
					name: 'Cliente A',
					phone: '11999990000',
					city: 'São Paulo',
					state: 'SP',
				},
			})

			await request(app.getHttpServer())
				.post('/orders')
				.send({
					customer_id: customer.id,
					order_number: `ORD-${Date.now()}`,
					items: [{ product_id: foreignProduct.id, quantity: 2, unit_price: 1000, discount: 0 }],
				})
				.expect(404)

			const stock = await prisma.store_stock.findUnique({
				where: { product_id: foreignProduct.id },
			})
			expect(stock?.quantity).toBe(50)
			// No order leaked into the attacker's tenant either.
			const orders = await prisma.order.count({ where: { seller_id: TEST_SELLER.id } })
			expect(orders).toBe(0)
		})
	})

	describe('H4 — public checkout scoped to the store slug', () => {
		it('returns 400 when ordering a product that belongs to a different store', async () => {
			const foreignProduct = await prisma.product.create({
				data: { seller_id: OTHER_SELLER.id, name: 'Produto da outra loja' },
			})

			await request(app.getHttpServer())
				.post(`/catalog/loja/${TEST_SELLER_SLUG}/orders`)
				.send({
					customer: { name: 'João Silva', phone: '11999998888' },
					items: [{ product_id: foreignProduct.id, quantity: 1 }],
				})
				.expect(400)

			const orders = await prisma.order.count()
			expect(orders).toBe(0)
		})

		it('returns 404 for an unknown store slug', async () => {
			const foreignProduct = await prisma.product.create({
				data: { seller_id: OTHER_SELLER.id, name: 'Produto da outra loja' },
			})

			await request(app.getHttpServer())
				.post('/catalog/loja/does-not-exist/orders')
				.send({
					customer: { name: 'João Silva', phone: '11999998888' },
					items: [{ product_id: foreignProduct.id, quantity: 1 }],
				})
				.expect(404)
		})
	})
})
