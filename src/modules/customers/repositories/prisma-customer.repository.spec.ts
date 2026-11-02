import { ConflictException, NotFoundException } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { PrismaService } from '@/shared/prisma/prisma.service'
import { TenantContext } from '@/shared/tenant/tenant.context'
import { PrismaCustomerRepository } from './prisma-customer.repository'

// Verifies the multi-tenant boundary at the repository layer: a seller can only
// read/mutate their own customers, admins bypass the filter, and missing/cross-tenant
// rows surface as 404 (NotFoundException) rather than leaking existence.
describe('PrismaCustomerRepository', () => {
	let repo: PrismaCustomerRepository
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
			customer: {
				findUnique: jest.fn(),
				findMany: jest.fn().mockResolvedValue([]),
				count: jest.fn().mockResolvedValue(0),
				update: jest.fn().mockResolvedValue({ id: 'c1' }),
				delete: jest.fn().mockResolvedValue({ id: 'c1' }),
			},
			billingPayment: { count: jest.fn().mockResolvedValue(0) },
		}

		const module = await Test.createTestingModule({
			providers: [
				PrismaCustomerRepository,
				{ provide: PrismaService, useValue: prisma },
				{ provide: TenantContext, useValue: tenant },
			],
		}).compile()

		repo = module.get(PrismaCustomerRepository)
	})

	describe('findById', () => {
		it('returns the customer when it belongs to the current seller', async () => {
			prisma.customer.findUnique.mockResolvedValue({ id: 'c1', seller_id: 'seller-1' })
			expect(await repo.findById('c1')).toEqual({ id: 'c1', seller_id: 'seller-1' })
		})

		it('returns null for a customer owned by another seller', async () => {
			prisma.customer.findUnique.mockResolvedValue({ id: 'c1', seller_id: 'other-seller' })
			expect(await repo.findById('c1')).toBeNull()
		})

		it('returns the customer for an admin regardless of owner', async () => {
			tenant.isAdmin.mockReturnValue(true)
			prisma.customer.findUnique.mockResolvedValue({ id: 'c1', seller_id: 'other-seller' })
			expect(await repo.findById('c1')).toEqual({ id: 'c1', seller_id: 'other-seller' })
		})
	})

	describe('update / delete tenant guard', () => {
		it('update throws NotFound for a cross-tenant customer', async () => {
			prisma.customer.findUnique.mockResolvedValue({ id: 'c1', seller_id: 'other-seller' })
			await expect(repo.update('c1', { name: 'x' } as any)).rejects.toBeInstanceOf(
				NotFoundException,
			)
			expect(prisma.customer.update).not.toHaveBeenCalled()
		})

		it('delete throws NotFound when the customer does not exist', async () => {
			prisma.customer.findUnique.mockResolvedValue(null)
			await expect(repo.delete('missing')).rejects.toBeInstanceOf(NotFoundException)
			expect(prisma.customer.delete).not.toHaveBeenCalled()
		})

		it('delete refuses (409 HAS_PAYMENTS) when the customer has ledger entries', async () => {
			prisma.customer.findUnique.mockResolvedValue({ id: 'c1', seller_id: 'seller-1' })
			prisma.billingPayment.count.mockResolvedValueOnce(3)

			const error = await repo.delete('c1').catch((e) => e)

			expect(error).toBeInstanceOf(ConflictException)
			expect(error.getResponse()).toMatchObject({ code: 'HAS_PAYMENTS' })
			expect(prisma.billingPayment.count).toHaveBeenCalledWith({
				where: { billing: { order: { customer_id: 'c1' } } },
			})
			expect(prisma.customer.delete).not.toHaveBeenCalled()
		})

		it('delete proceeds for an owned customer without payment history', async () => {
			prisma.customer.findUnique.mockResolvedValue({ id: 'c1', seller_id: 'seller-1' })

			await repo.delete('c1')

			expect(prisma.customer.delete).toHaveBeenCalledWith({ where: { id: 'c1' } })
		})

		it('update proceeds for an owned customer', async () => {
			prisma.customer.findUnique.mockResolvedValue({ id: 'c1', seller_id: 'seller-1' })
			await repo.update('c1', { name: 'x' } as any)
			expect(prisma.customer.update).toHaveBeenCalled()
		})
	})

	describe('findAll tenant scoping', () => {
		it('scopes the query to the current seller for non-admins', async () => {
			await repo.findAll()
			expect(prisma.customer.findMany).toHaveBeenCalledWith(
				expect.objectContaining({ where: expect.objectContaining({ seller_id: 'seller-1' }) }),
			)
		})

		it('does not inject a seller filter for admins', async () => {
			tenant.isAdmin.mockReturnValue(true)
			await repo.findAll()
			const where = prisma.customer.findMany.mock.calls[0][0].where
			expect(where.seller_id).toBeUndefined()
		})
	})
})
