import type { DomainEvent } from '@/shared/events/domain-event.types'
import { DomainEventHandlerRegistry } from '@/shared/events/domain-event-handler.registry'
import type { NotificationService } from '@/shared/websocket/notification.service'
import { StockNotificationsHandler } from './stock-notifications.handler'

const event = (
	payload: Record<string, unknown>,
	sellerId: string | null = 'seller-1',
): DomainEvent => ({
	id: 'evt-9',
	sellerId,
	aggregateType: 'stock',
	aggregateId: '7',
	eventType: 'stock.moved',
	payload: { productId: 7, productName: 'Camiseta', ...payload },
	occurredAt: new Date('2026-11-03T12:00:00Z'),
})

describe('StockNotificationsHandler', () => {
	const notifications = { create: jest.fn() }
	let registry: DomainEventHandlerRegistry
	let handler: StockNotificationsHandler

	beforeEach(() => {
		jest.resetAllMocks()
		registry = new DomainEventHandlerRegistry()
		handler = new StockNotificationsHandler(
			registry,
			notifications as unknown as NotificationService,
		)
	})

	it('subscribes to stock.moved at boot', () => {
		handler.onModuleInit()
		expect(registry.handlersFor('stock.moved')).toEqual([handler])
	})

	it('tells the seller about each order the restock covered, deduped per order', async () => {
		await handler.handle(
			event({
				fulfilled: [
					{ orderId: 1, orderNumber: 'PED-000001', quantity: 2 },
					{ orderId: 2, orderNumber: 'PED-000002', quantity: 1 },
				],
			}),
		)

		expect(notifications.create).toHaveBeenCalledTimes(2)
		expect(notifications.create).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				userId: 'seller-1',
				type: 'success',
				title: 'Reposição alocada a pedido',
				message:
					'A reposição de "Camiseta" cobriu o pedido PED-000001 (2 un). Pronto para finalizar.',
				data: { orderId: 1, orderNumber: 'PED-000001', productId: 7, quantity: 2 },
				dedupeKey: 'evt-9:stock-notifications:order:1',
			}),
		)
	})

	it('stays silent when nothing was covered or the event has no seller', async () => {
		await handler.handle(event({ fulfilled: [] }))
		await handler.handle(
			event({ fulfilled: [{ orderId: 1, orderNumber: 'X', quantity: 1 }] }, null),
		)

		expect(notifications.create).not.toHaveBeenCalled()
	})
})
