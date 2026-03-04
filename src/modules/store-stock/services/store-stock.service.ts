import { Inject, Injectable } from '@nestjs/common'
import {
	STORE_STOCK_REPOSITORY,
	type StoreStockRepository,
} from '@/shared/repositories/store-stock.repository'
import type { UpdateStoreStockDto } from '../dto/update-store-stock.dto'

@Injectable()
export class StoreStockService {
	constructor(
		@Inject(STORE_STOCK_REPOSITORY) private readonly storeStockRepository: StoreStockRepository,
	) {}

	async findAll() {
		return this.storeStockRepository.findAll({})
	}

	async getByProduct(productId: number) {
		return this.storeStockRepository.findByProduct(productId)
	}

	async upsert(productId: number, dto: UpdateStoreStockDto) {
		return this.storeStockRepository.upsert(productId, dto)
	}
}
