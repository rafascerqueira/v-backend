import { Injectable } from '@nestjs/common'
import type { DomainEventHandler } from './domain-event.types'

/**
 * Handlers subscribe here at boot, typically from their own `onModuleInit`:
 *
 *   @Injectable()
 *   export class OrderNotificationsHandler implements DomainEventHandler, OnModuleInit {
 *     readonly name = 'order-notifications'
 *     readonly eventTypes = [DOMAIN_EVENT_TYPES.ORDER_CREATED] as const
 *     constructor(private readonly registry: DomainEventHandlerRegistry) {}
 *     onModuleInit() { this.registry.register(this) }
 *     async handle(event: DomainEvent) { ... }
 *   }
 */
@Injectable()
export class DomainEventHandlerRegistry {
	private readonly handlers = new Map<string, DomainEventHandler>()

	register(handler: DomainEventHandler): void {
		if (this.handlers.has(handler.name)) {
			// Two handlers sharing a name would share effect job ids and dedupe keys,
			// silently dropping one of them. Fail the boot instead.
			throw new Error(`Domain event handler "${handler.name}" is already registered`)
		}
		this.handlers.set(handler.name, handler)
	}

	handlersFor(eventType: string): DomainEventHandler[] {
		return [...this.handlers.values()].filter((handler) =>
			(handler.eventTypes as readonly string[]).includes(eventType),
		)
	}

	get(name: string): DomainEventHandler | undefined {
		return this.handlers.get(name)
	}
}
