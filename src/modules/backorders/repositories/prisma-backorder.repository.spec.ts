import { Test } from '@nestjs/testing'
import { PrismaService } from '@/shared/prisma/prisma.service'
import { TenantContext } from '@/shared/tenant/tenant.context'
import { PrismaBackorderRepository } from './prisma-backorder.repository'

// Tenant scoping (reads filtered by seller_id) and the in-memory owed/pending-orders
// aggregation that feeds the products + stock "aguardando reposição" badge.
describe('PrismaBackorderRepository', () => {
	let repo: PrismaBackorderRepository
	let prisma: any
	const tenant = {
		isAdmin: jest.fn(),
		getSellerId: jest.fn(),
		requireSellerId: jest.fn(),
	}

	beforeEach(async () => {
		tenant.isAdmin.mockReturnValue(false)
		tenant.getSellerId.mockReturnValue('seller-A')
		tenant.requireSellerId.mockReturnValue('seller-A')

		prisma = {
			backorder: { findMany: jest.fn().mockResolvedValue([]) },
		}

		const module = await Test.createTestingModule({
			providers: [
				PrismaBackorderRepository,
				{ provide: PrismaService, useValue: prisma },
				{ provide: TenantContext, useValue: tenant },
			],
		}).compile()

		repo = module.get(PrismaBackorderRepository)
	})

	describe('summaryByProductIds', () => {
		it('returns an empty map without querying when no ids are given', async () => {
			const result = await repo.summaryByProductIds([])
			expect(result.size).toBe(0)
			expect(prisma.backorder.findMany).not.toHaveBeenCalled()
		})

		it('sums remaining owed units and counts distinct pending orders per product', async () => {
			prisma.backorder.findMany.mockResolvedValue([
				{ product_id: 7, order_id: 1, quantity: 3, fulfilled_quantity: 0 },
				{ product_id: 7, order_id: 2, quantity: 5, fulfilled_quantity: 2 }, // 3 remaining
				{ product_id: 9, order_id: 1, quantity: 4, fulfilled_quantity: 4 }, // 0 remaining → ignored
			])

			const result = await repo.summaryByProductIds([7, 9])

			expect(result.get(7)).toEqual({ owed: 6, pending_orders_count: 2 })
			// product 9 has nothing still owed → absent from the map.
			expect(result.has(9)).toBe(false)
			// scoped to the caller's seller and to pending rows.
			expect(prisma.backorder.findMany).toHaveBeenCalledWith(
				expect.objectContaining({
					where: expect.objectContaining({
						seller_id: 'seller-A',
						product_id: { in: [7, 9] },
						status: 'pending',
					}),
				}),
			)
		})
	})

	describe('list', () => {
		it('filters by tenant, product and status and orders FIFO', async () => {
			await repo.list({ productId: 7, status: 'pending' })

			expect(prisma.backorder.findMany).toHaveBeenCalledWith(
				expect.objectContaining({
					where: { seller_id: 'seller-A', product_id: 7, status: 'pending' },
					orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
				}),
			)
		})

		it('drops the seller filter for admins', async () => {
			tenant.isAdmin.mockReturnValue(true)
			await repo.list({})
			expect(prisma.backorder.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }))
		})
	})
})
