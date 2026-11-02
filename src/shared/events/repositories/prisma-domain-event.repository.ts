import { Injectable } from '@nestjs/common'
import { PrismaService } from '@/shared/prisma/prisma.service'
import type {
	DomainEventRepository,
	RelayBatchResult,
	RelayFailure,
} from '@/shared/repositories/domain-event.repository'
import type { DomainEvent } from '../domain-event.types'

interface DomainEventRow {
	id: string
	seller_id: string | null
	aggregate_type: string
	aggregate_id: string
	event_type: string
	payload: unknown
	occurred_at: Date
}

/** Long enough for a full batch of Redis enqueues; Prisma's 5 s default is tight. */
const RELAY_TX_TIMEOUT_MS = 30_000
const MAX_ERROR_LENGTH = 2_000

@Injectable()
export class PrismaDomainEventRepository implements DomainEventRepository {
	constructor(private readonly prisma: PrismaService) {}

	async relayPending(
		limit: number,
		publish: (event: DomainEvent) => Promise<void>,
	): Promise<RelayBatchResult> {
		return this.prisma.$transaction(
			async (tx) => {
				// SKIP LOCKED: a second relay (another instance, or a kick racing the
				// schedule) takes the next rows instead of waiting or double-publishing.
				const rows = await tx.$queryRaw<DomainEventRow[]>`
					SELECT id, seller_id, aggregate_type, aggregate_id, event_type, payload, occurred_at
					FROM domain_events
					WHERE published_at IS NULL
					ORDER BY occurred_at
					LIMIT ${limit}
					FOR UPDATE SKIP LOCKED`

				const publishedIds: string[] = []
				const failures: RelayFailure[] = []

				for (const row of rows) {
					try {
						await publish(toDomainEvent(row))
						publishedIds.push(row.id)
					} catch (error) {
						const message = (error instanceof Error ? error.message : String(error)).slice(
							0,
							MAX_ERROR_LENGTH,
						)
						const { attempts } = await tx.domainEvent.update({
							where: { id: row.id },
							data: { attempts: { increment: 1 }, last_error: message },
							select: { attempts: true },
						})
						failures.push({ eventId: row.id, eventType: row.event_type, attempts, error: message })
					}
				}

				if (publishedIds.length > 0) {
					await tx.domainEvent.updateMany({
						where: { id: { in: publishedIds } },
						data: { published_at: new Date() },
					})
				}

				return { locked: rows.length, published: publishedIds.length, failures }
			},
			{ timeout: RELAY_TX_TIMEOUT_MS },
		)
	}

	async findById(id: string): Promise<DomainEvent | null> {
		const row = await this.prisma.domainEvent.findUnique({
			where: { id },
			select: {
				id: true,
				seller_id: true,
				aggregate_type: true,
				aggregate_id: true,
				event_type: true,
				payload: true,
				occurred_at: true,
			},
		})
		return row ? toDomainEvent(row) : null
	}
}

function toDomainEvent(row: DomainEventRow): DomainEvent {
	return {
		id: row.id,
		sellerId: row.seller_id,
		aggregateType: row.aggregate_type,
		aggregateId: row.aggregate_id,
		eventType: row.event_type,
		payload: (row.payload ?? {}) as Record<string, unknown>,
		occurredAt: row.occurred_at,
	}
}
