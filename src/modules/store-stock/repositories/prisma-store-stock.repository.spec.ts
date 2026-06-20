import { NotFoundException } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { PrismaService } from '@/shared/prisma/prisma.service'
import { TenantContext } from '@/shared/tenant/tenant.context'
import { PrismaStoreStockRepository } from './prisma-store-stock.repository'

// Proves that store-stock writes can only target the caller's own products.
// upsert derives seller_id from the product, so without an ownership gate a seller
// could create/overwrite another tenant's stock by guessing a product id.
describe('PrismaStoreStockRepository', () => {
	let repo: PrismaStoreStockRepository
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
			product: { findUnique: jest.fn() },
			store_stock: {
				findUnique: jest.fn(),
				upsert: jest.fn().mockResolvedValue({ product_id: 1, quantity: 5 }),
			},
		}

		const module = await Test.createTestingModule({
			providers: [
				PrismaStoreStockRepository,
				{ provide: PrismaService, useValue: prisma },
				{ provide: TenantContext, useValue: tenant },
			],
		}).compile()

		repo = module.get(PrismaStoreStockRepository)
	})

	describe('upsert', () => {
		it('throws NotFound when the product does not exist and never writes', async () => {
			prisma.product.findUnique.mockResolvedValue(null)
			await expect(repo.upsert(99, { quantity: 5 })).rejects.toBeInstanceOf(NotFoundException)
			expect(prisma.store_stock.upsert).not.toHaveBeenCalled()
		})

		it('throws NotFound for a product owned by another seller and never writes', async () => {
			prisma.product.findUnique.mockResolvedValue({ seller_id: 'seller-B' })
			await expect(repo.upsert(7, { quantity: 5 })).rejects.toBeInstanceOf(NotFoundException)
			expect(prisma.store_stock.upsert).not.toHaveBeenCalled()
		})

		it('upserts when the product belongs to the caller', async () => {
			prisma.product.findUnique.mockResolvedValue({ seller_id: 'seller-A' })
			await repo.upsert(7, { quantity: 5 })
			expect(prisma.store_stock.upsert).toHaveBeenCalled()
		})

		it('lets an admin upsert any product (filter bypassed)', async () => {
			tenant.isAdmin.mockReturnValue(true)
			prisma.product.findUnique.mockResolvedValue({ seller_id: 'seller-B' })
			await repo.upsert(7, { quantity: 5 })
			expect(prisma.store_stock.upsert).toHaveBeenCalled()
		})
	})

	describe('findByProduct', () => {
		it('returns null for a stock row owned by another seller', async () => {
			prisma.store_stock.findUnique.mockResolvedValue({ product_id: 7, seller_id: 'seller-B' })
			const result = await repo.findByProduct(7)
			expect(result).toBeNull()
		})

		it('returns the row for the owning seller', async () => {
			prisma.store_stock.findUnique.mockResolvedValue({ product_id: 7, seller_id: 'seller-A' })
			const result = await repo.findByProduct(7)
			expect(result).not.toBeNull()
		})
	})
})
