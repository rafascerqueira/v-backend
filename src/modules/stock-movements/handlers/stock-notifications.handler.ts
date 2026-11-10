import { Injectable, type OnModuleInit } from '@nestjs/common'
import {
	DOMAIN_EVENT_TYPES,
	type DomainEvent,
	type DomainEventHandler,
	domainEffectDedupeKey,
} from '@/shared/events/domain-event.types'
import { DomainEventHandlerRegistry } from '@/shared/events/domain-event-handler.registry'
import { NotificationService } from '@/shared/websocket/notification.service'

interface StockMovedPayload {
	productId: number
	productName: string
	fulfilled?: Array<{ orderId: number; orderNumber: string; quantity: number }>
}

/**
 * Tells the seller which waiting orders a restock just covered, driven by
 * stock.moved. One notification per fully covered order, each with its own dedupe
 * key, so a redelivered effect never notifies twice.
 */
@Injectable()
export class StockNotificationsHandler implements DomainEventHandler, OnModuleInit {
	readonly name = 'stock-notifications'
	readonly eventTypes = [DOMAIN_EVENT_TYPES.STOCK_MOVED] as const

	constructor(
		private readonly registry: DomainEventHandlerRegistry,
		private readonly notifications: NotificationService,
	) {}

	onModuleInit(): void {
		this.registry.register(this)
	}

	async handle(event: DomainEvent): Promise<void> {
		if (!event.sellerId) return
		const payload = event.payload as unknown as StockMovedPayload

		for (const order of payload.fulfilled ?? []) {
			await this.notifications.create({
				userId: event.sellerId,
				type: 'success',
				title: 'Reposição alocada a pedido',
				message: `A reposição de "${payload.productName}" cobriu o pedido ${order.orderNumber} (${order.quantity} un). Pronto para finalizar.`,
				data: {
					orderId: order.orderId,
					orderNumber: order.orderNumber,
					productId: payload.productId,
					quantity: order.quantity,
				},
				dedupeKey: domainEffectDedupeKey(event, this.name, `order:${order.orderId}`),
			})
		}
	}
}
