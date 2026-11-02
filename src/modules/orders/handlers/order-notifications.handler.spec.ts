import type { DomainEvent } from '@/shared/events/domain-event.types'
import { DomainEventHandlerRegistry } from '@/shared/events/domain-event-handler.registry'
import type { NotificationService } from '@/shared/websocket/notification.service'
import { OrderNotificationsHandler } from './order-notifications.handler'

const event = (
	payload: Record<string, unknown>,
	sellerId: string | null = 'seller-1',
): DomainEvent => ({
	id: 'evt-1',
	sellerId,
	aggregateType: 'order',
	aggregateId: '42',
	eventType: 'order.created',
	payload: { orderId: 42, orderNumber: 'PED-000042', total: 12990, oversold: [], ...payload },
	occurredAt: new Date('2026-11-02T12:00:00Z'),
})

describe('OrderNotificationsHandler', () => {
	const notifications = { create: jest.fn() }
	let registry: DomainEventHandlerRegistry
	let handler: OrderNotificationsHandler

	beforeEach(() => {
		jest.resetAllMocks()
		registry = new DomainEventHandlerRegistry()
		handler = new OrderNotificationsHandler(
			registry,
			notifications as unknown as NotificationService,
		)
	})

	it('subscribes to order.created at boot', () => {
		handler.onModuleInit()

		expect(registry.handlersFor('order.created')).toEqual([handler])
	})

	it('announces a storefront order to the seller, money in pt-BR', async () => {
		await handler.handle(event({ source: 'storefront' }))

		expect(notifications.create).toHaveBeenCalledTimes(1)
		expect(notifications.create).toHaveBeenCalledWith(
			expect.objectContaining({
				userId: 'seller-1',
				type: 'success',
				title: 'Novo pedido na loja',
				message: 'Pedido PED-000042 recebido pela loja online, no valor de R$ 129,90.',
				data: { orderId: 42, orderNumber: 'PED-000042', total: 12990 },
				dedupeKey: 'evt-1:order-notifications:storefront',
			}),
		)
	})

	it('does not announce dashboard orders (the seller created them)', async () => {
		await handler.handle(event({ source: 'dashboard' }))

		expect(notifications.create).not.toHaveBeenCalled()
	})

	it('warns once per item sold past its stock, each with its own dedupe key', async () => {
		await handler.handle(
			event({
				source: 'dashboard',
				oversold: [
					{ productId: 7, productName: 'Camiseta', available: 1, requested: 5 },
					{ productId: 8, productName: 'Boné', available: 0, requested: 2 },
				],
			}),
		)

		expect(notifications.create).toHaveBeenCalledTimes(2)
		expect(notifications.create).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				type: 'warning',
				title: 'Venda sem estoque',
				message:
					'"Camiseta" foi vendido sem estoque no pedido PED-000042 (disponível: 1, vendido: 5). Entrega pendente.',
				data: { orderNumber: 'PED-000042', productId: 7, available: 1, requested: 5 },
				sendEmail: true,
				dedupeKey: 'evt-1:order-notifications:oversold:0',
			}),
		)
		expect(notifications.create.mock.calls[1][0].dedupeKey).toBe(
			'evt-1:order-notifications:oversold:1',
		)
	})

	it('ignores events without a seller', async () => {
		await handler.handle(event({ source: 'storefront' }, null))

		expect(notifications.create).not.toHaveBeenCalled()
	})

	it('lets a failed notification throw so the effect job is retried', async () => {
		notifications.create.mockRejectedValueOnce(new Error('db down'))

		await expect(handler.handle(event({ source: 'storefront' }))).rejects.toThrow('db down')
	})
})
