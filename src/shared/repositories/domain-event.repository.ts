import type { DomainEvent } from '@/shared/events/domain-event.types'

export const DOMAIN_EVENT_REPOSITORY = Symbol('DOMAIN_EVENT_REPOSITORY')

export interface RelayFailure {
	eventId: string
	eventType: string
	/** Attempts after this failure. */
	attempts: number
	error: string
}

export interface RelayBatchResult {
	/** Events locked for this batch (published + failed). */
	locked: number
	published: number
	failures: RelayFailure[]
}

/**
 * System-level access to the outbox. The relay and the effect worker run outside any
 * request, so these methods are deliberately NOT tenant-scoped; tenant-facing reads
 * (e.g. an order's timeline) belong in the owning module's repository.
 */
export interface DomainEventRepository {
	/**
	 * In one transaction: lock up to `limit` unpublished events, oldest first, with
	 * `FOR UPDATE SKIP LOCKED` (concurrent relays never take the same rows), call
	 * `publish` for each, then stamp `published_at` on the successes and bump
	 * `attempts`/`last_error` on the failures.
	 */
	relayPending(
		limit: number,
		publish: (event: DomainEvent) => Promise<void>,
	): Promise<RelayBatchResult>

	findById(id: string): Promise<DomainEvent | null>
}
