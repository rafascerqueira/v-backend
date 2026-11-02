import type { Prisma } from '@/generated/prisma/client'
import { appendDomainEvents } from './append-domain-events'
import { DOMAIN_EVENT_TYPES, domainEffectDedupeKey, domainEffectJobId } from './domain-event.types'

const makeTx = () => {
	const createMany = jest.fn().mockResolvedValue({ count: 0 })
	return { tx: { domainEvent: { createMany } } as unknown as Prisma.TransactionClient, createMany }
}

describe('appendDomainEvents', () => {
	it('writes the events through the given transaction client, aggregate id as text', async () => {
		const { tx, createMany } = makeTx()

		await appendDomainEvents(tx, [
			{
				sellerId: 'seller-1',
				aggregateType: 'order',
				aggregateId: 42,
				eventType: DOMAIN_EVENT_TYPES.ORDER_CREATED,
				payload: { orderId: 42, total: 1990 },
			},
			{
				sellerId: null,
				aggregateType: 'stock',
				aggregateId: 'p-7',
				eventType: DOMAIN_EVENT_TYPES.STOCK_MOVED,
				payload: {},
			},
		])

		expect(createMany).toHaveBeenCalledWith({
			data: [
				{
					seller_id: 'seller-1',
					aggregate_type: 'order',
					aggregate_id: '42',
					event_type: 'order.created',
					payload: { orderId: 42, total: 1990 },
				},
				{
					seller_id: null,
					aggregate_type: 'stock',
					aggregate_id: 'p-7',
					event_type: 'stock.moved',
					payload: {},
				},
			],
		})
	})

	it('does not touch the database when there is nothing to append', async () => {
		const { tx, createMany } = makeTx()

		await appendDomainEvents(tx, [])

		expect(createMany).not.toHaveBeenCalled()
	})
})

describe('effect ids', () => {
	it('builds BullMQ job ids without ":" (BullMQ rejects it in custom ids)', () => {
		expect(domainEffectJobId('evt-1', 'order-notifications')).toBe('evt-1.order-notifications')
		expect(domainEffectJobId('evt-1', 'h')).not.toContain(':')
	})

	it('builds dedupe keys per handler, optionally per part', () => {
		expect(domainEffectDedupeKey({ id: 'evt-1' }, 'h')).toBe('evt-1:h')
		expect(domainEffectDedupeKey({ id: 'evt-1' }, 'h', 3)).toBe('evt-1:h:3')
	})
})
