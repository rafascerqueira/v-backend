import { Inject, Injectable } from '@nestjs/common'
import { QueueProducer } from '@/shared/queue/queue.producer'
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
		private readonly queueProducer: QueueProducer,
	) {}

	async listByProduct(productId: number) {
		return this.stockMovementRepository.findByProduct(productId)
	}

	async create(dto: CreateStockMovementDto) {
		const { movement, fulfilled } = await this.stockMovementRepository.create(dto)

		// Tell the seller which open orders this arrival just covered. Enqueued (not
		// sent inline) per the side-effect rule, after the commit so it never fires
		// on a rolled-back movement.
		for (const order of fulfilled) {
			await this.queueProducer.createNotification({
				userId: order.seller_id,
				type: 'success',
				title: 'Reposição alocada a pedido',
				message: `A reposição de "${order.product_name}" cobriu o pedido ${order.order_number} (${order.quantity} un). Pronto para finalizar.`,
				data: {
					orderId: order.order_id,
					orderNumber: order.order_number,
					productId: order.product_id,
					quantity: order.quantity,
				},
			})
		}

		// Keep the HTTP response shape as the movement itself (unchanged for callers).
		return movement
	}
}
