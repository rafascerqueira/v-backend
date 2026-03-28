import { Inject, Injectable } from '@nestjs/common'
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
	) {}

	async create(data: CreateProductData) {
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

	async update(id: string, data: UpdateProductDto) {
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
