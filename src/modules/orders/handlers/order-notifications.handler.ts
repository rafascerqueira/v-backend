import { Injectable, type OnModuleInit } from '@nestjs/common'
import {
	DOMAIN_EVENT_TYPES,
	type DomainEvent,
	type DomainEventHandler,
	domainEffectDedupeKey,
} from '@/shared/events/domain-event.types'
import { DomainEventHandlerRegistry } from '@/shared/events/domain-event-handler.registry'
import { formatBRL } from '@/shared/money/format-brl'
import { NotificationService } from '@/shared/websocket/notification.service'

interface OversoldEntry {
	productId: number
	productName: string
	available: number
	requested: number
}

interface OrderCreatedPayload {
	orderId: number
	orderNumber: string
	source: 'dashboard' | 'storefront'
	total: number
	oversold?: OversoldEntry[]
}

/**
 * Seller notifications for a new order, driven by order.created (replaces the
 * enqueue-after-commit in OrdersService, which lost notifications when Redis failed
 * and could 500 on an order that was already saved). Each notification has its own
 * dedupe key, so a redelivered effect never notifies twice.
 */
@Injectable()
export class OrderNotificationsHandler implements DomainEventHandler, OnModuleInit {
	readonly name = 'order-notifications'
	readonly eventTypes = [DOMAIN_EVENT_TYPES.ORDER_CREATED] as const

	constructor(
		private readonly registry: DomainEventHandlerRegistry,
		private readonly notifications: NotificationService,
	) {}

	onModuleInit(): void {
		this.registry.register(this)
	}

	async handle(event: DomainEvent): Promise<void> {
		if (!event.sellerId) return
		const payload = event.payload as unknown as OrderCreatedPayload

		if (payload.source === 'storefront') {
			await this.notifications.create({
				userId: event.sellerId,
				type: 'success',
				title: 'Novo pedido na loja',
				message: `Pedido ${payload.orderNumber} recebido pela loja online, no valor de ${formatBRL(payload.total)}.`,
				data: { orderId: payload.orderId, orderNumber: payload.orderNumber, total: payload.total },
				sendEmail: true,
				dedupeKey: domainEffectDedupeKey(event, this.name, 'storefront'),
			})
		}

		// Items sold past their stock (allow_oversell): units pending delivery.
		for (const [index, item] of (payload.oversold ?? []).entries()) {
			await this.notifications.create({
				userId: event.sellerId,
				type: 'warning',
				title: 'Venda sem estoque',
				message: `"${item.productName}" foi vendido sem estoque no pedido ${payload.orderNumber} (disponível: ${item.available}, vendido: ${item.requested}). Entrega pendente.`,
				data: {
					orderNumber: payload.orderNumber,
					productId: item.productId,
					available: item.available,
					requested: item.requested,
				},
				sendEmail: true,
				dedupeKey: domainEffectDedupeKey(event, this.name, `oversold:${index}`),
			})
		}
	}
}
