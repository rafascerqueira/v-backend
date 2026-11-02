import { Inject, Injectable } from '@nestjs/common'
import { OutboxRelayService } from '@/shared/events/outbox-relay.service'
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
		private readonly outboxRelay: OutboxRelayService,
	) {}

	async listByProduct(productId: number) {
		return this.stockMovementRepository.findByProduct(productId)
	}

	/**
	 * The "Reposição alocada a pedido" notification now follows from the stock.moved
	 * event written in the same transaction (StockNotificationsHandler) instead of an
	 * enqueue after the commit, which a Redis failure could lose.
	 */
	async create(dto: CreateStockMovementDto) {
		const { movement } = await this.stockMovementRepository.create(dto)
		// Not awaited: kick() never throws, but a degraded Redis would delay the response.
		void this.outboxRelay.kick()
		// Keep the HTTP response shape as the movement itself (unchanged for callers).
		return movement
	}

	/** Sets the on-hand quantity through an `adjustment` movement of the difference. */
	async adjustTo(productId: number, target: number) {
		const result = await this.stockMovementRepository.adjustTo(productId, target)
		if (result) void this.outboxRelay.kick()
		return result?.movement ?? null
	}
}
