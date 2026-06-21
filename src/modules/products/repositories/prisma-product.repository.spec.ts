import { NotFoundException } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { PrismaService } from '@/shared/prisma/prisma.service'
import { BACKORDER_REPOSITORY } from '@/shared/repositories/backorder.repository'
import { TenantContext } from '@/shared/tenant/tenant.context'
import { PrismaProductRepository } from './prisma-product.repository'

// Verifies the multi-tenant boundary at the repository layer: a seller can only
// read/mutate their own products, admins bypass the filter, and missing/cross-tenant
// rows surface as 404 (NotFoundException). findAll also excludes soft-deleted rows.
describe('PrismaProductRepository', () => {
	let repo: PrismaProductRepository
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
			product: {
				findUnique: jest.fn(),
				findMany: jest.fn().mockResolvedValue([]),
				count: jest.fn().mockResolvedValue(0),
				update: jest.fn().mockResolvedValue({ id: 1 }),
			},
		}

		const module = await Test.createTestingModule({
			providers: [
				PrismaProductRepository,
				{ provide: PrismaService, useValue: prisma },
				{ provide: TenantContext, useValue: tenant },
				{
					provide: BACKORDER_REPOSITORY,
					useValue: { summaryByProductIds: jest.fn().mockResolvedValue(new Map()) },
				},
			],
		}).compile()

		repo = module.get(PrismaProductRepository)
	})

	describe('findById', () => {
		it('returns the product when it belongs to the current seller', async () => {
			prisma.product.findUnique.mockResolvedValue({ id: 1, seller_id: 'seller-1' })
			expect(await repo.findById(1)).toEqual({ id: 1, seller_id: 'seller-1' })
		})

		it('returns null for a product owned by another seller', async () => {
			prisma.product.findUnique.mockResolvedValue({ id: 1, seller_id: 'other-seller' })
			expect(await repo.findById(1)).toBeNull()
		})

		it('returns the product for an admin regardless of owner', async () => {
			tenant.isAdmin.mockReturnValue(true)
			prisma.product.findUnique.mockResolvedValue({ id: 1, seller_id: 'other-seller' })
			expect(await repo.findById(1)).toEqual({ id: 1, seller_id: 'other-seller' })
		})
	})

	describe('update / softDelete tenant guard', () => {
		it('update throws NotFound for a cross-tenant product', async () => {
			prisma.product.findUnique.mockResolvedValue({ id: 1, seller_id: 'other-seller' })
			await expect(repo.update(1, { name: 'x' } as any)).rejects.toBeInstanceOf(NotFoundException)
			expect(prisma.product.update).not.toHaveBeenCalled()
		})

		it('softDelete throws NotFound when the product does not exist', async () => {
			prisma.product.findUnique.mockResolvedValue(null)
			await expect(repo.softDelete(999)).rejects.toBeInstanceOf(NotFoundException)
			expect(prisma.product.update).not.toHaveBeenCalled()
		})

		it('softDelete sets deletedAt for an owned product', async () => {
			prisma.product.findUnique.mockResolvedValue({ id: 1, seller_id: 'seller-1' })
			await repo.softDelete(1)
			expect(prisma.product.update).toHaveBeenCalledWith(
				expect.objectContaining({ data: expect.objectContaining({ deletedAt: expect.any(Date) }) }),
			)
		})
	})

	describe('findAll tenant scoping', () => {
		it('scopes to the current seller and excludes soft-deleted rows', async () => {
			await repo.findAll()
			expect(prisma.product.findMany).toHaveBeenCalledWith(
				expect.objectContaining({
					where: expect.objectContaining({ seller_id: 'seller-1', deletedAt: null }),
				}),
			)
		})

		it('does not inject a seller filter for admins', async () => {
			tenant.isAdmin.mockReturnValue(true)
			await repo.findAll()
			const where = prisma.product.findMany.mock.calls[0][0].where
			expect(where.seller_id).toBeUndefined()
		})
	})
})
