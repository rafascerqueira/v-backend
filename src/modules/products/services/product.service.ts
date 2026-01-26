import { Injectable, Inject } from '@nestjs/common'
import { PrismaService } from '@/shared/prisma/prisma.service'
import {
	PRODUCT_REPOSITORY,
	type ProductRepository,
	type CreateProductData,
} from '@/shared/repositories/product.repository'
import type { CreateProductDto } from '../dto/create-product.dto'
import type { UpdateProductDto } from '../dto/update-product.dto'
import type { PaginationDto } from '@/shared/dto/pagination.dto'
import { createPaginatedResponse } from '@/shared/dto/pagination.dto'

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
		const { data, total } = await (this.productRepository as any).findAllPaginated(params)
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

	async addPrice(productId: number, price: number, priceType: string) {
		// Deactivate existing prices of the same type
		await this.prisma.product_price.updateMany({
			where: { product_id: productId, price_type: priceType as any, active: true },
			data: { active: false },
		})

		return this.prisma.product_price.create({
			data: {
				product_id: productId,
				price,
				price_type: priceType as any,
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
