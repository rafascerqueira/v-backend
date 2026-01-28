import { Inject, Injectable } from '@nestjs/common'
import type { PaginationDto } from '@/shared/dto/pagination.dto'
import { createPaginatedResponse } from '@/shared/dto/pagination.dto'
import { PrismaService } from '@/shared/prisma/prisma.service'
import {
	type CreateProductData,
	PRODUCT_REPOSITORY,
	type ProductRepository,
} from '@/shared/repositories/product.repository'
import type { CreateProductDto } from '../dto/create-product.dto'
import type { UpdateProductDto } from '../dto/update-product.dto'
import type { PriceType } from '@/generated/prisma/enums'

@Injectable()
export class ProductService {
	constructor(
		@Inject(PRODUCT_REPOSITORY)
		private readonly productRepository: ProductRepository,
		private readonly prisma: PrismaService,
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
		return this.productRepository.findById(parseInt(id))
	}

	async update(id: string, data: UpdateProductDto) {
		return this.productRepository.update(parseInt(id), data)
	}

	async remove(id: string) {
		return this.productRepository.softDelete(parseInt(id))
	}

	async addPrice(productId: number, price: number, priceType: PriceType) {
		// Deactivate existing prices of the same type
		await this.prisma.product_price.updateMany({
			where: { product_id: productId, price_type: priceType, active: true },
			data: { active: false },
		})

		return this.prisma.product_price.create({
			data: {
				product_id: productId,
				price,
				price_type: priceType,
				active: true,
			},
		})
	}

	async getProductPrices(productId: number) {
		return this.prisma.product_price.findMany({
			where: { product_id: productId, active: true },
			orderBy: { createdAt: 'desc' },
		})
	}
}
