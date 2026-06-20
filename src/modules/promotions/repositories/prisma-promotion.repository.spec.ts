import { NotFoundException } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { PrismaService } from '@/shared/prisma/prisma.service'
import { TenantContext } from '@/shared/tenant/tenant.context'
import { PrismaPromotionRepository } from './prisma-promotion.repository'

// Proves a seller can only build/read a promotion on their own product, and that
// ending a promotion is gated on tenant ownership at the repo (not only the service).
describe('PrismaPromotionRepository', () => {
	let repo: PrismaPromotionRepository
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
			product: { findFirst: jest.fn() },
			product_price: { findFirst: jest.fn() },
			promotion: {
				findFirst: jest.fn(),
				update: jest.fn().mockResolvedValue({
					id: 1,
					start_date: new Date(),
					end_date: new Date(),
					status: 'expired',
					product: { id: 1, name: 'P' },
				}),
			},
		}

		const module = await Test.createTestingModule({
			providers: [
				PrismaPromotionRepository,
				{ provide: PrismaService, useValue: prisma },
				{ provide: TenantContext, useValue: tenant },
			],
		}).compile()

		repo = module.get(PrismaPromotionRepository)
	})

	describe('getLatestProductPrice', () => {
		it('throws NotFound for a product owned by another seller (no price leak)', async () => {
			prisma.product.findFirst.mockResolvedValue(null) // verifyProductOwnership fails
			await expect(repo.getLatestProductPrice(7)).rejects.toBeInstanceOf(NotFoundException)
			expect(prisma.product_price.findFirst).not.toHaveBeenCalled()
		})

		it('returns the latest sale price when the product belongs to the caller', async () => {
			prisma.product.findFirst.mockResolvedValue({ id: 7 })
			prisma.product_price.findFirst.mockResolvedValue({ price: 5000 })
			expect(await repo.getLatestProductPrice(7)).toBe(5000)
		})

		it('returns 0 when the owned product has no active sale price', async () => {
			prisma.product.findFirst.mockResolvedValue({ id: 7 })
			prisma.product_price.findFirst.mockResolvedValue(null)
			expect(await repo.getLatestProductPrice(7)).toBe(0)
		})
	})

	describe('end ownership gate', () => {
		it('throws NotFound for a cross-tenant promotion and never writes', async () => {
			prisma.promotion.findFirst.mockResolvedValue(null) // findById is tenant-scoped
			await expect(repo.end(1)).rejects.toBeInstanceOf(NotFoundException)
			expect(prisma.promotion.update).not.toHaveBeenCalled()
		})

		it('ends a promotion the caller owns', async () => {
			prisma.promotion.findFirst.mockResolvedValue({
				id: 1,
				start_date: new Date(Date.now() - 1000),
				end_date: new Date(Date.now() + 100000),
				status: 'active',
				product: { id: 1, name: 'P' },
			})
			const result = await repo.end(1)
			expect(prisma.promotion.update).toHaveBeenCalledWith(
				expect.objectContaining({ where: { id: 1 }, data: { status: 'expired' } }),
			)
			expect(result.status).toBe('expired')
		})
	})
})
