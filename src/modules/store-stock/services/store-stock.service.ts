import { Inject, Injectable } from '@nestjs/common'
import { StockMovementsService } from '@/modules/stock-movements/services/stock-movements.service'
import {
	STORE_STOCK_REPOSITORY,
	type StoreStockRepository,
} from '@/shared/repositories/store-stock.repository'
import type { UpdateStoreStockDto } from '../dto/update-store-stock.dto'

@Injectable()
export class StoreStockService {
	constructor(
		@Inject(STORE_STOCK_REPOSITORY) private readonly storeStockRepository: StoreStockRepository,
		private readonly stockMovements: StockMovementsService,
	) {}

	async findAll() {
		return this.storeStockRepository.findAll({})
	}

	async getByProduct(productId: number) {
		return this.storeStockRepository.findByProduct(productId)
	}

	/**
	 * A quantity change is never written as an absolute value: it becomes an
	 * `adjustment` movement of the difference, applied under the stock lock, so a
	 * concurrent sale can't be lost and the movement history adds up to the stock.
	 * The other fields (reserved, min/max) are plain settings.
	 */
	async upsert(productId: number, dto: UpdateStoreStockDto) {
		const { quantity, ...settings } = dto
		if (quantity !== undefined) {
			await this.stockMovements.adjustTo(productId, quantity)
		}
		return this.storeStockRepository.upsert(productId, settings)
	}
}
