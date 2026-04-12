import { Inject, Injectable } from '@nestjs/common'
import {
	PRODUCT_PRICE_REPOSITORY,
	type ProductPriceRepository,
} from '@/shared/repositories/product-price.repository'
import type { CreateProductPriceDto } from '../dto/create-product-price.dto'
import type { UpdateProductPriceDto } from '../dto/update-product-price.dto'

@Injectable()
export class ProductPricesService {
	constructor(
		@Inject(PRODUCT_PRICE_REPOSITORY)
		private readonly productPriceRepository: ProductPriceRepository,
	) {}

	async listByProduct(productId: number) {
		return this.productPriceRepository.findByProduct(productId)
	}

	async create(productId: number, dto: CreateProductPriceDto) {
		const { valid_from, valid_to, ...rest } = dto

		return this.productPriceRepository.create({
			product_id: productId,
			...rest,
			valid_from: valid_from ? new Date(valid_from) : valid_from === null ? null : undefined,
			valid_to: valid_to ? new Date(valid_to) : valid_to === null ? null : undefined,
		})
	}

	async update(id: number, dto: UpdateProductPriceDto) {
		const { valid_from, valid_to, ...rest } = dto
		return this.productPriceRepository.update(id, {
			...rest,
			valid_from: valid_from ? new Date(valid_from) : valid_from === null ? null : undefined,
			valid_to: valid_to ? new Date(valid_to) : valid_to === null ? null : undefined,
		})
	}

	async deactivate(id: number) {
		return this.productPriceRepository.deactivate(id)
	}

	async hasProductPrice(id: number) {
		return this.productPriceRepository.findById(id)
	}

	async getPriceHistory(productId: number) {
		return this.productPriceRepository.findPriceHistory(productId)
	}
}
