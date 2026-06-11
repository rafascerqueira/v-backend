/**
 * PromotionsService unit tests
 *
 * Business invariants worth pinning down:
 *  - end_date must be strictly after start_date (no zero/negative-length promos)
 *  - product must have an active sale price before a discount is applied
 *  - promotional_price math: round(original * (1 - pct/100)) — financial calc
 *    in integer cents; off-by-one rounding bugs here turn into cash-flow issues
 *  - status is 'scheduled' when start_date is in the future, 'active' otherwise
 *  - findOne / end propagate NotFound when missing (no silent no-op)
 */
import { BadRequestException, NotFoundException } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import {
	PROMOTION_REPOSITORY,
	type PromotionRepository,
} from '@/shared/repositories/promotion.repository'
import { PromotionsService } from './promotions.service'

const repo: jest.Mocked<PromotionRepository> = {
	findAll: jest.fn(),
	findById: jest.fn(),
	create: jest.fn(),
	end: jest.fn(),
	getLatestProductPrice: jest.fn(),
}

describe('PromotionsService', () => {
	let service: PromotionsService

	beforeEach(async () => {
		const module = await Test.createTestingModule({
			providers: [PromotionsService, { provide: PROMOTION_REPOSITORY, useValue: repo }],
		}).compile()
		service = module.get(PromotionsService)
		jest.clearAllMocks()
	})

	describe('findOne', () => {
		it('returns the promotion when found', async () => {
			const promo = { id: 1 } as never
			repo.findById.mockResolvedValueOnce(promo)
			await expect(service.findOne(1)).resolves.toBe(promo)
		})

		it('throws NotFound when missing', async () => {
			repo.findById.mockResolvedValueOnce(null)
			await expect(service.findOne(999)).rejects.toThrow(NotFoundException)
		})
	})

	describe('create — date validation', () => {
		const baseInput = {
			seller_id: 'seller-1',
			product_id: 10,
			discount_percent: 20,
			description: 'Black Friday',
		}

		it('rejects when end_date == start_date (zero-length promo)', async () => {
			await expect(
				service.create({
					...baseInput,
					start_date: '2026-12-25',
					end_date: '2026-12-25',
				} as never),
			).rejects.toThrow(/end_date must be after start_date/)
		})

		it('rejects when end_date < start_date', async () => {
			await expect(
				service.create({
					...baseInput,
					start_date: '2026-12-25',
					end_date: '2026-12-24',
				} as never),
			).rejects.toThrow(BadRequestException)
		})
	})

	describe('create — product price requirement', () => {
		it('rejects when product has no active sale price (would compute discount on 0)', async () => {
			repo.getLatestProductPrice.mockResolvedValueOnce(0)

			await expect(
				service.create({
					seller_id: 's',
					product_id: 10,
					discount_percent: 20,
					start_date: '2099-01-01',
					end_date: '2099-12-31',
				} as never),
			).rejects.toThrow(/active sale price/)

			expect(repo.create).not.toHaveBeenCalled()
		})
	})

	describe('create — promotional price math', () => {
		it('rounds price correctly (integer cents)', async () => {
			repo.getLatestProductPrice.mockResolvedValueOnce(9999) // R$ 99,99
			repo.create.mockResolvedValueOnce({ id: 1 } as never)

			await service.create({
				seller_id: 's',
				product_id: 10,
				discount_percent: 33,
				start_date: '2099-01-01',
				end_date: '2099-12-31',
			} as never)

			// 9999 * (1 - 0.33) = 9999 * 0.67 = 6699.33 → round → 6699
			expect(repo.create).toHaveBeenCalledWith(
				expect.objectContaining({
					original_price: 9999,
					promotional_price: 6699,
					discount_percent: 33,
				}),
			)
		})

		it('handles 99% discount without going below 0', async () => {
			repo.getLatestProductPrice.mockResolvedValueOnce(100)
			repo.create.mockResolvedValueOnce({ id: 1 } as never)

			await service.create({
				seller_id: 's',
				product_id: 10,
				discount_percent: 99,
				start_date: '2099-01-01',
				end_date: '2099-12-31',
			} as never)

			expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ promotional_price: 1 }))
		})
	})

	describe('create — status derivation', () => {
		it('marks promotion "scheduled" when start_date is in the future', async () => {
			repo.getLatestProductPrice.mockResolvedValueOnce(1000)
			repo.create.mockResolvedValueOnce({ id: 1 } as never)

			await service.create({
				seller_id: 's',
				product_id: 10,
				discount_percent: 20,
				start_date: '2099-01-01',
				end_date: '2099-12-31',
			} as never)

			expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ status: 'scheduled' }))
		})

		it('marks promotion "active" when start_date is in the past', async () => {
			repo.getLatestProductPrice.mockResolvedValueOnce(1000)
			repo.create.mockResolvedValueOnce({ id: 1 } as never)

			await service.create({
				seller_id: 's',
				product_id: 10,
				discount_percent: 20,
				start_date: '2020-01-01',
				end_date: '2099-12-31',
			} as never)

			expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ status: 'active' }))
		})
	})

	describe('end', () => {
		it('throws NotFound before touching the repository when promotion is missing', async () => {
			repo.findById.mockResolvedValueOnce(null)

			await expect(service.end(42)).rejects.toThrow(NotFoundException)
			expect(repo.end).not.toHaveBeenCalled()
		})

		it('calls repo.end when promotion exists', async () => {
			repo.findById.mockResolvedValueOnce({ id: 42 } as never)
			repo.end.mockResolvedValueOnce({ id: 42, status: 'expired' } as never)

			const result = await service.end(42)

			expect(repo.end).toHaveBeenCalledWith(42)
			expect(result).toEqual({ id: 42, status: 'expired' })
		})
	})
})
