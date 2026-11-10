import type { Prisma } from '@/generated/prisma/client'
import type { NewDomainEvent } from './domain-event.types'

/**
 * Appends domain events through the caller's transaction client. Call it only from a
 * repository, inside the same `$transaction` as the write the events describe: the
 * events then commit or roll back together with it (no dual write to Redis).
 *
 * Services should call `OutboxRelayService.kick()` after the repository returns, so
 * the effects run right away instead of on the next 5-second relay tick.
 */
export async function appendDomainEvents(
	tx: Prisma.TransactionClient,
	events: readonly NewDomainEvent[],
): Promise<void> {
	if (events.length === 0) return

	await tx.domainEvent.createMany({
		data: events.map((event) => ({
			seller_id: event.sellerId,
			aggregate_type: event.aggregateType,
			aggregate_id: String(event.aggregateId),
			event_type: event.eventType,
			payload: event.payload as Prisma.InputJsonValue,
		})),
	})
}
