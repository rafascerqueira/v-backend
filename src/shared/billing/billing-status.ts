export type DerivedBillingStatus = 'pending' | 'partial' | 'paid'
export type DerivedPaymentStatus = 'pending' | 'confirmed'

export interface DerivedBilling {
	status: DerivedBillingStatus
	payment_status: DerivedPaymentStatus
}

/**
 * Derives a billing's payment progress from its amounts (both integer cents) so
 * the stored state can never contradict the money — e.g. status='paid' with
 * paid_amount=0 is no longer representable. Callers must persist the result
 * instead of trusting client-supplied status/payment_status.
 *
 * `overdue` is intentionally NOT produced here: it is a read-time overlay on a
 * stored `pending`/`partial` whose due date has passed (see applyOverdue in the
 * billing repository). `canceled` is a terminal lifecycle state owned by order
 * cancellation and is preserved by callers, not derived.
 *
 * Note: paid_amount is validated as <= total_amount upstream, so paid > total is
 * not expected; it still maps to `paid` defensively.
 */
export function deriveBillingStatus(paidAmount: number, totalAmount: number): DerivedBilling {
	if (paidAmount <= 0) {
		return { status: 'pending', payment_status: 'pending' }
	}
	if (paidAmount >= totalAmount) {
		return { status: 'paid', payment_status: 'confirmed' }
	}
	return { status: 'partial', payment_status: 'pending' }
}
