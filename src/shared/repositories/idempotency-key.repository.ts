export const IDEMPOTENCY_KEY_REPOSITORY = Symbol('IDEMPOTENCY_KEY_REPOSITORY')

/**
 * Idempotency-Key ledger. Phase 1B only ships the table and its retention job; the
 * record/lookup methods arrive with the first endpoint that honours the header (1A).
 */
export interface IdempotencyKeyRepository {
	/** Deletes keys created before `cutoff`, across all tenants. Returns how many. */
	deleteCreatedBefore(cutoff: Date): Promise<number>
}
