import { DOMAIN_EVENT_TYPES, type DomainEventHandler } from './domain-event.types'
import { DomainEventHandlerRegistry } from './domain-event-handler.registry'

const handler = (
	name: string,
	eventTypes: DomainEventHandler['eventTypes'],
): DomainEventHandler => ({ name, eventTypes, handle: jest.fn() })

describe('DomainEventHandlerRegistry', () => {
	let registry: DomainEventHandlerRegistry

	beforeEach(() => {
		registry = new DomainEventHandlerRegistry()
	})

	it('returns every handler subscribed to an event type, and only those', () => {
		const a = handler('a', [DOMAIN_EVENT_TYPES.ORDER_CREATED])
		const b = handler('b', [DOMAIN_EVENT_TYPES.ORDER_CREATED, DOMAIN_EVENT_TYPES.STOCK_MOVED])
		const c = handler('c', [DOMAIN_EVENT_TYPES.STOCK_MOVED])
		for (const h of [a, b, c]) registry.register(h)

		expect(registry.handlersFor(DOMAIN_EVENT_TYPES.ORDER_CREATED)).toEqual([a, b])
		expect(registry.handlersFor(DOMAIN_EVENT_TYPES.STOCK_MOVED)).toEqual([b, c])
		expect(registry.handlersFor('unknown.event')).toEqual([])
	})

	it('looks handlers up by name', () => {
		const a = handler('a', [DOMAIN_EVENT_TYPES.ORDER_CREATED])
		registry.register(a)

		expect(registry.get('a')).toBe(a)
		expect(registry.get('missing')).toBeUndefined()
	})

	it('refuses a second handler with the same name (it would share job ids and dedupe keys)', () => {
		registry.register(handler('a', [DOMAIN_EVENT_TYPES.ORDER_CREATED]))

		expect(() => registry.register(handler('a', [DOMAIN_EVENT_TYPES.STOCK_MOVED]))).toThrow(
			/already registered/,
		)
	})
})
