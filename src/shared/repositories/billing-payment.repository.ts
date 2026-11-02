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
	/** Owner of the charge (e.g. whose dashboard cache to invalidate). */
	sellerId: string
	replayed: boolean
}

/** PATCH /billings/:id, applied atomically under the charge lock. */
export interface UpdateChargeInput {
	billingId: number
	totalAmount?: number
	/** DEPRECATED absolute paid_amount: a higher value records the difference. */
	paidAmountTarget?: number
	paymentMethod?: PaymentMethod
	/** Method for the legacy payment when the request sends none. */
	fallbackMethod?: string
	/** paid_at of the legacy payment (defaults to now). */
	paidAt?: Date
	dueDate?: Date | null
	notes?: string
	legacyNote: string
	createdBy: string
}

export interface UpdateChargeResult {
	/** The ledger payment created from a higher paid_amount, if any. */
	recorded: BillingPaymentEntry | null
	sellerId: string
}

/** POST /orders/:id/billings: the charge and what was already paid, atomically. */
export interface OpenChargeInput {
	orderId: number
	billingNumber: string
	totalAmount: number
	paymentMethod: PaymentMethod
	dueDate?: Date
	notes?: string
	initialPayment?: { amount: number; paidAt: Date; note: string; createdBy: string }
}

/**
 * Append-only money ledger of a charge. Every write runs in one transaction with
 * the charge row locked (FOR UPDATE), so concurrent payments can't lose updates,
 * and keeps billings.paid_amount / status / payment_date / payment_method in sync.
 * Tenant-scoped: another seller's charge is a 404.
 */
export interface BillingPaymentRepository {
	/**
	 * 400 on a canceled charge, an amount above the open balance, or a paid_at in the
	 * future / before 2000. 409 LEDGER_DRIFT when the stored balance disagrees with
	 * the ledger.
	 */
	record(input: RecordPaymentInput): Promise<LedgerWriteResult>
	/** 404 unknown payment; 400 when it is itself a reversal; 409 already reversed. */
	reverse(input: ReversePaymentInput): Promise<LedgerWriteResult>
	/** Entries oldest first; null when the charge doesn't exist for this tenant. */
	list(billingId: number): Promise<BillingPaymentEntry[] | null>
	/** PATCH: validated and derived from the locked row; 409 LEDGER_DRIFT, 400 rules. */
	updateCharge(input: UpdateChargeInput): Promise<UpdateChargeResult>
	/** Creates a charge (paid 0) and, in the same transaction, its first payment. */
	openCharge(input: OpenChargeInput): Promise<{ billingId: number; sellerId: string }>
}
