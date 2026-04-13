import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import {
	PROMOTION_REPOSITORY,
	type PromotionRepository,
} from '@/shared/repositories/promotion.repository'
import type { CreatePromotionDto } from '../dto/create-promotion.dto'

@Injectable()
export class PromotionsService {
	constructor(
		@Inject(PROMOTION_REPOSITORY)
		private readonly repo: PromotionRepository,
	) {}

	findAll() {
		return this.repo.findAll()
	}

	async findOne(id: number) {
		const promotion = await this.repo.findById(id)
		if (!promotion) throw new NotFoundException('Promotion not found')
		return promotion
	}

	async create(data: CreatePromotionDto & { seller_id: string }) {
		const startDate = new Date(data.start_date)
		const endDate = new Date(data.end_date)

		if (endDate <= startDate) {
			throw new BadRequestException('end_date must be after start_date')
		}

		const originalPrice = await this.repo.getLatestProductPrice(data.product_id)
		if (originalPrice === 0) {
			throw new BadRequestException('Product has no active sale price set')
		}
		const promotionalPrice = Math.round(originalPrice * (1 - data.discount_percent / 100))

		const now = new Date()
		const status = now < startDate ? 'scheduled' : 'active'

		return this.repo.create({
			seller_id: data.seller_id,
			product_id: data.product_id,
			discount_percent: data.discount_percent,
			original_price: originalPrice,
			promotional_price: promotionalPrice,
			start_date: startDate,
			end_date: endDate,
			description: data.description,
			status,
		})
	}

	async end(id: number) {
		await this.findOne(id)
		return this.repo.end(id)
	}
}
