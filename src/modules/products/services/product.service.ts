import { ForbiddenException, Inject, Injectable } from '@nestjs/common'
import { FEATURE_UPGRADE_MESSAGE } from '@/modules/subscriptions/guards/feature.guard'
import { PlanLimitsService } from '@/modules/subscriptions/services/plan-limits.service'
import type { PaginationDto } from '@/shared/dto/pagination.dto'
import { createPaginatedResponse } from '@/shared/dto/pagination.dto'
import {
	type CreateProductData,
	PRODUCT_REPOSITORY,
	type ProductRepository,
} from '@/shared/repositories/product.repository'
import {
	PRODUCT_PRICE_REPOSITORY,
	type ProductPriceRepository,
} from '@/shared/repositories/product-price.repository'
import type { CreateProductDto } from '../dto/create-product.dto'
import type { UpdateProductDto } from '../dto/update-product.dto'

@Injectable()
export class ProductService {
	constructor(
		@Inject(PRODUCT_REPOSITORY)
		private readonly productRepository: ProductRepository,
		@Inject(PRODUCT_PRICE_REPOSITORY)
		private readonly productPriceRepository: ProductPriceRepository,
		private readonly planLimitsService: PlanLimitsService,
	) {}

	// Multiple images per product is a paid feature. Only a count > 1 is gated, so
	// free sellers keep a single image. Plan is the caller's, resolved at the edge.
	private async assertImagesAllowed(sellerId: string, planType: string, images?: string[]) {
		if (images && images.length > 1) {
			const allowed = await this.planLimitsService.hasFeature(sellerId, planType, 'multipleImages')
			if (!allowed) {
				throw new ForbiddenException(FEATURE_UPGRADE_MESSAGE.multipleImages)
			}
		}
	}

	async create(data: CreateProductData, planType: string) {
		await this.assertImagesAllowed(data.seller_id, planType, data.images)
		return this.productRepository.create(data)
	}

	async findAll() {
		return this.productRepository.findAll()
	}

	async findAllPaginated(params: PaginationDto) {
		const { data, total } = await this.productRepository.findAllPaginated(params)
		return createPaginatedResponse(data, total, params.page, params.limit)
	}

	async findById(id: string) {
		return this.productRepository.findById(parseInt(id, 10))
	}

	async update(id: string, data: UpdateProductDto, sellerId: string, planType: string) {
		await this.assertImagesAllowed(sellerId, planType, data.images)
		return this.productRepository.update(parseInt(id, 10), data)
	}

	async remove(id: string) {
		return this.productRepository.softDelete(parseInt(id, 10))
	}

	async addPrice(productId: number, price: number, priceType: string) {
		return this.productPriceRepository.create({
			product_id: productId,
			price,
			price_type: priceType,
			active: true,
		})
	}

	async getProductPrices(productId: number) {
		return this.productPriceRepository.findByProduct(productId)
	}
}
