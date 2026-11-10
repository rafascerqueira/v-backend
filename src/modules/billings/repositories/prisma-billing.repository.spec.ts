import { ConflictException, NotFoundException } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { PrismaService } from '@/shared/prisma/prisma.service'
import { TenantContext } from '@/shared/tenant/tenant.context'
import { PrismaBillingRepository } from './prisma-billing.repository'

// Tenancy is enforced through the related order (order.seller_id); since Phase 1A
// billings also carry a denormalised seller_id (billing numbers are unique per
// seller), always derived from the order on create. These tests pin that list AND point-lookup
// queries constrain by the owning seller for non-admins, that findById returns
// null for a foreign billing (so the service answers 404, never a 403 that would
// leak the id exists), and that update/delete refuse to write a cross-tenant row.
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
				findFirst: jest.fn(),
				update: jest.fn().mockResolvedValue({ id: 5, status: 'paid', due_date: null }),
				delete: jest.fn(),
				create: jest.fn().mockResolvedValue({ id: 9, status: 'pending', due_date: null }),
			},
			order: { findUnique: jest.fn() },
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

	describe('create', () => {
		const input = {
			order_id: 3,
			billing_number: 'COB-MANUAL-1',
			total_amount: 1000,
			paid_amount: 0,
			payment_method: 'cash',
			payment_status: 'pending',
			status: 'pending',
		}

		it("stamps the order's seller on the charge (never a caller-supplied one)", async () => {
			prisma.order.findUnique.mockResolvedValueOnce({ seller_id: 'seller-1' })

			await repo.create(input)

			expect(prisma.order.findUnique).toHaveBeenCalledWith({
				where: { id: 3 },
				select: { seller_id: true },
			})
			expect(prisma.billing.create.mock.calls[0][0].data).toMatchObject({
				order_id: 3,
				seller_id: 'seller-1',
				billing_number: 'COB-MANUAL-1',
			})
		})

		it('404s when the order does not exist', async () => {
			prisma.order.findUnique.mockResolvedValueOnce(null)

			await expect(repo.create(input)).rejects.toBeInstanceOf(NotFoundException)
			expect(prisma.billing.create).not.toHaveBeenCalled()
		})
	})

	describe('findAll tenant scoping', () => {
		it('constrains to the owning seller (billings.seller_id) for non-admins', async () => {
			await repo.findAll({})
			const where = prisma.billing.findMany.mock.calls[0][0].where
			expect(where.seller_id).toBe('seller-1')
		})

		it('does not constrain by seller for admins', async () => {
			tenant.isAdmin.mockReturnValue(true)
			await repo.findAll({})
			const where = prisma.billing.findMany.mock.calls[0][0].where
			expect(where.seller_id).toBeUndefined()
		})
	})

	describe('findByOrderId tenant scoping', () => {
		it('constrains by both order id and owning seller', async () => {
			await repo.findByOrderId(42, {})
			const where = prisma.billing.findMany.mock.calls[0][0].where
			expect(where.order_id).toBe(42)
			expect(where.seller_id).toBe('seller-1')
		})
	})

	describe('findById (point lookup)', () => {
		it('tenant-scopes by seller_id — a foreign billing returns null (404, not a 403 leak)', async () => {
			prisma.billing.findFirst.mockResolvedValue(null) // scoped query excludes foreign rows
			const row = await repo.findById(5)
			expect(row).toBeNull()
			const where = prisma.billing.findFirst.mock.calls[0][0].where
			expect(where.id).toBe(5)
			expect(where.seller_id).toBe('seller-1')
		})

		it('returns the row for the owning seller', async () => {
			prisma.billing.findFirst.mockResolvedValue({
				id: 5,
				status: 'paid',
				due_date: null,
				order: { seller_id: 'seller-1' },
			})
			const row = await repo.findById(5)
			expect(row).not.toBeNull()
		})

		it('does not constrain by seller for admins', async () => {
			tenant.isAdmin.mockReturnValue(true)
			prisma.billing.findFirst.mockResolvedValue({
				id: 5,
				status: 'paid',
				due_date: null,
				order: { seller_id: 'whoever' },
			})
			await repo.findById(5)
			const where = prisma.billing.findFirst.mock.calls[0][0].where
			expect(where.seller_id).toBeUndefined()
		})
	})

	describe('update / delete ownership gate', () => {
		it('update throws NotFound for a cross-tenant billing and never writes', async () => {
			prisma.billing.findFirst.mockResolvedValue(null)
			await expect(repo.update(5, { paid_amount: 100 } as any)).rejects.toBeInstanceOf(
				NotFoundException,
			)
			expect(prisma.billing.update).not.toHaveBeenCalled()
		})
	})

	describe('delete (locked, 409 HAS_PAYMENTS)', () => {
		let tx: any

		beforeEach(() => {
			tx = {
				$queryRaw: jest.fn().mockResolvedValue([{ id: 5 }]),
				billingPayment: { count: jest.fn().mockResolvedValue(0) },
				billing: { delete: jest.fn() },
			}
			prisma.$transaction = jest.fn((cb: any) => cb(tx))
		})

		it('locks the tenant’s row and deletes a charge without ledger entries', async () => {
			await repo.delete(5)

			const [sql, ...params] = tx.$queryRaw.mock.calls[0]
			expect(sql.join('?')).toContain('FOR UPDATE')
			expect(params).toEqual([5, 'seller-1', 'seller-1'])
			expect(tx.billing.delete).toHaveBeenCalledWith({ where: { id: 5 } })
		})

		it('404s for a cross-tenant billing and never writes', async () => {
			tx.$queryRaw.mockResolvedValueOnce([])

			await expect(repo.delete(5)).rejects.toBeInstanceOf(NotFoundException)
			expect(tx.billing.delete).not.toHaveBeenCalled()
		})

		it('409s HAS_PAYMENTS when the charge has ledger entries (history is never erased)', async () => {
			tx.billingPayment.count.mockResolvedValueOnce(2)

			const error = await repo.delete(5).catch((e) => e)

			expect(error).toBeInstanceOf(ConflictException)
			expect(error.getResponse()).toMatchObject({ code: 'HAS_PAYMENTS' })
			expect(tx.billing.delete).not.toHaveBeenCalled()
		})

		it('lets an admin delete any tenant’s charge (no seller filter)', async () => {
			tenant.isAdmin.mockReturnValue(true)

			await repo.delete(5)

			expect(tx.$queryRaw.mock.calls[0].slice(1)).toEqual([5, null, null])
		})
	})
})
