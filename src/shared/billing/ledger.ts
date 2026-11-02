/**
 * Payment ledger arithmetic (Phase 1C). Pure, integer cents only.
 *
 * A charge's paid_amount is the balance of its append-only ledger:
 *   Σ payments − Σ reversals
 * (a reversal always mirrors the full amount of the payment it cancels).
 */

export interface LedgerEntryLike {
	id: number
	kind: 'payment' | 'reversal'
	amount: number
	method: string
	paid_at: Date
	reversal_of_id: number | null
	created_at: Date
}

export interface LedgerSummary {
	/** Σ payments − Σ reversals, in cents. */
	paidAmount: number
	/** paid_at of the latest payment that has not been reversed; null when none. */
	lastPaymentDate: Date | null
	/** Method of the most recently recorded entry (payment or reversal); null when empty. */
	lastMethod: string | null
}

export function summarizeLedger(entries: readonly LedgerEntryLike[]): LedgerSummary {
	const reversed = new Set(
		entries
			.filter((e) => e.kind === 'reversal' && e.reversal_of_id !== null)
			.map((e) => e.reversal_of_id),
	)

	let paidAmount = 0
	let lastPaymentDate: Date | null = null
	let lastEntry: LedgerEntryLike | null = null

	for (const entry of entries) {
		paidAmount += entry.kind === 'payment' ? entry.amount : -entry.amount
		if (entry.kind === 'payment' && !reversed.has(entry.id)) {
			if (!lastPaymentDate || entry.paid_at > lastPaymentDate) lastPaymentDate = entry.paid_at
		}
		if (
			!lastEntry ||
			entry.created_at > lastEntry.created_at ||
			(entry.created_at.getTime() === lastEntry.created_at.getTime() && entry.id > lastEntry.id)
		) {
			lastEntry = entry
		}
	}

	return { paidAmount, lastPaymentDate, lastMethod: lastEntry?.method ?? null }
}
