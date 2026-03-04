import { Inject, Injectable } from '@nestjs/common'
import {
	STOCK_MOVEMENT_REPOSITORY,
	type StockMovementRepository,
} from '@/shared/repositories/stock-movement.repository'
import type { CreateStockMovementDto } from '../dto/create-stock-movement.dto'

@Injectable()
export class StockMovementsService {
	constructor(
		@Inject(STOCK_MOVEMENT_REPOSITORY)
		private readonly stockMovementRepository: StockMovementRepository,
	) {}

	async listByProduct(productId: number) {
		return this.stockMovementRepository.findByProduct(productId)
	}

	async create(dto: CreateStockMovementDto) {
		return this.stockMovementRepository.create(dto)
	}
}
