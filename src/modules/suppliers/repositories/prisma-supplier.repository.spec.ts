import { BadRequestException, NotFoundException } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { PrismaService } from '@/shared/prisma/prisma.service'
import { TenantContext } from '@/shared/tenant/tenant.context'
import { PrismaSupplierRepository } from './prisma-supplier.repository'

// Proves per-seller isolation on the supplier debt paths that have no service-layer
// guard (payDebt / findDebts go straight to the repo), plus the repo-level gate on
// point mutations. Cross-tenant access must look non-existent (404) and never write.
describe('PrismaSupplierRepository', () => {
	let repo: PrismaSupplierRepository
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
			supplier: { findFirst: jest.fn(), update: jest.fn() },
			supplier_debt: {
				findFirst: jest.fn(),
				findMany: jest.fn().mockResolvedValue([]),
				update: jest.fn().mockResolvedValue({ id: 1 }),
			},
		}

		const module = await Test.createTestingModule({
			providers: [
				PrismaSupplierRepository,
				{ provide: PrismaService, useValue: prisma },
				{ provide: TenantContext, useValue: tenant },
			],
		}).compile()

		repo = module.get(PrismaSupplierRepository)
	})

	describe('payDebt', () => {
		it('throws NotFound for a cross-tenant (or missing) debt and never writes', async () => {
			prisma.supplier_debt.findFirst.mockResolvedValue(null)

			await expect(repo.payDebt(1, 100)).rejects.toBeInstanceOf(NotFoundException)
			expect(prisma.supplier_debt.update).not.toHaveBeenCalled()
			// The lookup is scoped through the owning supplier's seller.
			const where = prisma.supplier_debt.findFirst.mock.calls[0][0].where
			expect(where.id).toBe(1)
			expect(where.supplier).toEqual({ seller_id: 'seller-A' })
		})

		it('rejects a payment that exceeds the outstanding amount', async () => {
			prisma.supplier_debt.findFirst.mockResolvedValue({ id: 1, amount: 1000, paid_amount: 800 })

			await expect(repo.payDebt(1, 300)).rejects.toBeInstanceOf(BadRequestException)
			expect(prisma.supplier_debt.update).not.toHaveBeenCalled()
		})

		it('records a partial payment (integer cents)', async () => {
			prisma.supplier_debt.findFirst.mockResolvedValue({ id: 1, amount: 1000, paid_amount: 0 })

			await repo.payDebt(1, 400)

			expect(prisma.supplier_debt.update).toHaveBeenCalledWith({
				where: { id: 1 },
				data: { paid_amount: 400, status: 'partial' },
			})
		})

		it('marks the debt paid when the payment settles it exactly', async () => {
			prisma.supplier_debt.findFirst.mockResolvedValue({ id: 1, amount: 1000, paid_amount: 600 })

			await repo.payDebt(1, 400)

			expect(prisma.supplier_debt.update).toHaveBeenCalledWith({
				where: { id: 1 },
				data: { paid_amount: 1000, status: 'paid' },
			})
		})

		it('lets an admin pay any debt (filter bypassed)', async () => {
			tenant.isAdmin.mockReturnValue(true)
			prisma.supplier_debt.findFirst.mockResolvedValue({ id: 1, amount: 1000, paid_amount: 0 })

			await repo.payDebt(1, 100)

			const where = prisma.supplier_debt.findFirst.mock.calls[0][0].where
			expect(where.supplier).toEqual({})
		})
	})

	describe('findDebts', () => {
		it('scopes by the owning supplier seller for non-admins', async () => {
			await repo.findDebts('sup-1')
			const where = prisma.supplier_debt.findMany.mock.calls[0][0].where
			expect(where.supplier_id).toBe('sup-1')
			expect(where.supplier).toEqual({ seller_id: 'seller-A' })
		})
	})

	describe('update / delete ownership gate', () => {
		it('update throws NotFound for a cross-tenant supplier and never writes', async () => {
			prisma.supplier.findFirst.mockResolvedValue(null) // findById is tenant-scoped
			await expect(repo.update('sup-X', { name: 'x' })).rejects.toBeInstanceOf(NotFoundException)
			expect(prisma.supplier.update).not.toHaveBeenCalled()
		})

		it('delete throws NotFound for a cross-tenant supplier and never writes', async () => {
			prisma.supplier.findFirst.mockResolvedValue(null)
			await expect(repo.delete('sup-X')).rejects.toBeInstanceOf(NotFoundException)
			expect(prisma.supplier.update).not.toHaveBeenCalled()
		})
	})
})
