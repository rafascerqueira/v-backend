/**
 * Domain events (Phase 1, transactional outbox).
 *
 * A repository appends `NewDomainEvent`s inside the same `$transaction` as the
 * business write (`appendDomainEvents`), so an event exists iff that write committed.
 * The outbox relay later publishes each stored event to every handler subscribed to
 * its type, as one BullMQ job per (event, handler). Delivery is at-least-once, so
 * every handler must be idempotent (e.g. pass a `dedupeKey` to NotificationService).
 */

export const DOMAIN_EVENT_TYPES = {
	ORDER_CREATED: 'order.created',
	ORDER_STATUS_CHANGED: 'order.status_changed',
	ORDER_DELETED: 'order.deleted',
	BILLING_PAYMENT_RECORDED: 'billing.payment_recorded',
	BILLING_PAYMENT_REVERSED: 'billing.payment_reversed',
	STOCK_MOVED: 'stock.moved',
} as const

export type DomainEventType = (typeof DOMAIN_EVENT_TYPES)[keyof typeof DOMAIN_EVENT_TYPES]

/**
 * What a repository appends. The payload is kept forever as history, so it carries
 * ids, numbers and amounts in cents only — never customer PII (names, e-mails,
 * phones, documents); handlers look those up when they need them.
 */
export interface NewDomainEvent {
	/** Owning tenant; null only for system-level events. */
	sellerId: string | null
	aggregateType: string
	aggregateId: string | number
	eventType: DomainEventType
	payload: Record<string, unknown>
}

/** A stored event, as handlers receive it. */
export interface DomainEvent {
	id: string
	sellerId: string | null
	aggregateType: string
	aggregateId: string
	eventType: string
	payload: Record<string, unknown>
	occurredAt: Date
}

export interface DomainEventHandler {
	/**
	 * Stable and unique across the app. It is part of the effect job id and of the
	 * consumers' dedupe keys, so renaming a live handler re-runs its pending effects.
	 */
	readonly name: string
	readonly eventTypes: readonly DomainEventType[]
	/**
	 * Runs in a worker, inside the event's tenant context when it has a seller.
	 * May run more than once for the same event: it must be idempotent.
	 */
	handle(event: DomainEvent): Promise<void>
}

export interface DomainEffectJobData {
	eventId: string
	handler: string
}

/** BullMQ rejects ':' in custom job ids, hence the '.' separator. */
export function domainEffectJobId(eventId: string, handler: string): string {
	return `${eventId}.${handler}`
}

/**
 * Dedupe key for a side effect produced by `handler` for `event`. Add `part` when one
 * event yields several effects (e.g. one notification per oversold item).
 */
export function domainEffectDedupeKey(
	event: Pick<DomainEvent, 'id'>,
	handler: string,
	part?: string | number,
): string {
	return part === undefined ? `${event.id}:${handler}` : `${event.id}:${handler}:${part}`
}
