import type { IdempotencyRequest } from '@/shared/idempotency/idempotency'

export const BILLING_PAYMENT_REPOSITORY = Symbol('BILLING_PAYMENT_REPOSITORY')

export type PaymentMethod = 'cash' | 'credit_card' | 'debit_card' | 'pix'

export interface BillingPaymentEntry {
	id: number
	billing_id: number
	kind: 'payment' | 'reversal'
	/** Cents, always > 0 (a reversal mirrors the payment it cancels). */
	amount: number
	method: PaymentMethod
	paid_at: Date
	note: string | null
	created_by: string | null
	reversal_of_id: number | null
	created_at: Date
}

export interface RecordPaymentInput {
	billingId: number
	amount: number
	method: PaymentMethod
	paidAt: Date
	note?: string
	/** Account recording it (the caller). */
	createdBy: string
	idempotency?: IdempotencyRequest
}

export interface ReversePaymentInput {
	billingId: number
	paymentId: number
	reason: string
	createdBy: string
	idempotency?: IdempotencyRequest
}

/** `replayed`: the Idempotency-Key was already used with the same body; nothing was written. */
export interface LedgerWriteResult {
	entry: BillingPaymentEntry
	replayed: boolean
}

/**
 * Append-only money ledger of a charge. Every write runs in one transaction with
 * the charge row locked (FOR UPDATE), so concurrent payments can't lose updates,
 * and keeps billings.paid_amount / status / payment_date / payment_method in sync.
 * Tenant-scoped: another seller's charge is a 404.
 */
export interface BillingPaymentRepository {
	/** 400 on a canceled charge or an amount above the open balance. */
	record(input: RecordPaymentInput): Promise<LedgerWriteResult>
	/** 404 unknown payment; 400 when it is itself a reversal; 409 already reversed. */
	reverse(input: ReversePaymentInput): Promise<LedgerWriteResult>
	/** Entries oldest first; null when the charge doesn't exist for this tenant. */
	list(billingId: number): Promise<BillingPaymentEntry[] | null>
}
