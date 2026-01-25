import { Injectable, Inject } from '@nestjs/common'
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
}
