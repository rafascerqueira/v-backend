import { type LedgerEntryLike, summarizeLedger } from './ledger'

const at = (iso: string) => new Date(iso)
const payment = (id: number, amount: number, paidAt: string, method = 'pix'): LedgerEntryLike => ({
	id,
	kind: 'payment',
	amount,
	method,
	paid_at: at(paidAt),
	reversal_of_id: null,
	created_at: at(paidAt),
})
const reversal = (id: number, of: LedgerEntryLike, createdAt: string): LedgerEntryLike => ({
	id,
	kind: 'reversal',
	amount: of.amount,
	method: of.method,
	paid_at: at(createdAt),
	reversal_of_id: of.id,
	created_at: at(createdAt),
})

describe('summarizeLedger', () => {
	it('is empty for no entries', () => {
		expect(summarizeLedger([])).toEqual({ paidAmount: 0, lastPaymentDate: null, lastMethod: null })
	})

	it('sums payments minus reversals, in integer cents', () => {
		const a = payment(1, 1990, '2026-11-01T10:00:00Z', 'cash')
		const b = payment(2, 3010, '2026-11-02T10:00:00Z', 'pix')

		const summary = summarizeLedger([a, b, reversal(3, a, '2026-11-03T10:00:00Z')])

		expect(summary.paidAmount).toBe(3010)
		expect(Number.isInteger(summary.paidAmount)).toBe(true)
	})

	it('dates the charge by the latest payment that was not reversed', () => {
		const early = payment(1, 1000, '2026-11-01T10:00:00Z')
		const late = payment(2, 1000, '2026-11-05T10:00:00Z')

		const summary = summarizeLedger([early, late, reversal(3, late, '2026-11-06T10:00:00Z')])

		expect(summary.lastPaymentDate).toEqual(at('2026-11-01T10:00:00Z'))
	})

	it('has no payment date once everything was reversed', () => {
		const a = payment(1, 1000, '2026-11-01T10:00:00Z')

		expect(summarizeLedger([a, reversal(2, a, '2026-11-02T10:00:00Z')])).toMatchObject({
			paidAmount: 0,
			lastPaymentDate: null,
		})
	})

	it('takes the method of the most recently recorded entry (id breaks ties)', () => {
		const a = payment(1, 1000, '2026-11-01T10:00:00Z', 'cash')
		const b = { ...payment(2, 1000, '2026-11-01T10:00:00Z', 'credit_card') }

		expect(summarizeLedger([b, a]).lastMethod).toBe('credit_card')
	})

	it('dates by paid_at, not by when it was typed in (back-dated payment)', () => {
		const recent = payment(1, 1000, '2026-11-05T10:00:00Z')
		const backDated = {
			...payment(2, 1000, '2026-10-20T10:00:00Z'),
			created_at: at('2026-11-06T10:00:00Z'),
		}

		expect(summarizeLedger([recent, backDated]).lastPaymentDate).toEqual(at('2026-11-05T10:00:00Z'))
	})
})
