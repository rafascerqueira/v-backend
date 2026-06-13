import { Test } from '@nestjs/testing'
import { PrismaService } from '@/shared/prisma/prisma.service'
import { TenantContext } from '@/shared/tenant/tenant.context'
import { PrismaBillingRepository } from './prisma-billing.repository'

// Billing rows have no seller_id of their own — tenancy is enforced through the
// related order (order.seller_id). These tests pin that the list queries always
// constrain by the owning seller for non-admins, and document that point-lookup
// (findById) is intentionally unscoped because BillingsService is the ownership
// boundary for update/delete (it checks billing.order.seller_id and 403s).
describe('PrismaBillingRepository', () => {
	let repo: PrismaBillingRepository
	let prisma: any
	const tenant = {
		isAdmin: jest.fn(),
		getSellerId: jest.fn(),
		requireSellerId: jest.fn(),
	}

	beforeEach(async () => {
		tenant.isAdmin.mockReturnValue(false)
		tenant.getSellerId.mockReturnValue('seller-1')
		tenant.requireSellerId.mockReturnValue('seller-1')

		prisma = {
			billing: {
				findMany: jest.fn().mockResolvedValue([]),
				findUnique: jest.fn(),
			},
		}

		const module = await Test.createTestingModule({
			providers: [
				PrismaBillingRepository,
				{ provide: PrismaService, useValue: prisma },
				{ provide: TenantContext, useValue: tenant },
			],
		}).compile()

		repo = module.get(PrismaBillingRepository)
	})

	describe('findAll tenant scoping', () => {
		it('constrains to the owning seller via the related order for non-admins', async () => {
			await repo.findAll({})
			const where = prisma.billing.findMany.mock.calls[0][0].where
			expect(where.order).toEqual({ seller_id: 'seller-1' })
		})

		it('does not constrain by seller for admins', async () => {
			tenant.isAdmin.mockReturnValue(true)
			await repo.findAll({})
			const where = prisma.billing.findMany.mock.calls[0][0].where
			expect(where.order).toBeUndefined()
		})
	})

	describe('findByOrderId tenant scoping', () => {
		it('constrains by both order id and owning seller', async () => {
			await repo.findByOrderId(42, {})
			const where = prisma.billing.findMany.mock.calls[0][0].where
			expect(where.order_id).toBe(42)
			expect(where.order).toEqual({ seller_id: 'seller-1' })
		})
	})

	describe('findById (point lookup)', () => {
		it('returns the row unscoped — ownership is enforced by the service layer', async () => {
			prisma.billing.findUnique.mockResolvedValue({
				id: 5,
				status: 'paid',
				due_date: null,
				order: { seller_id: 'other-seller' },
			})
			const row = await repo.findById(5)
			expect(row).not.toBeNull()
			// No tenant filter applied here by design; BillingsService.update/delete
			// reject cross-tenant access with ForbiddenException.
			expect(prisma.billing.findUnique).toHaveBeenCalledWith(
				expect.objectContaining({ where: { id: 5 } }),
			)
		})
	})
})
