import { deriveBillingStatus } from './billing-status'

describe('deriveBillingStatus', () => {
	it('is pending/pending when nothing was paid', () => {
		expect(deriveBillingStatus(0, 1000)).toEqual({ status: 'pending', payment_status: 'pending' })
	})

	it('is partial/pending for a payment below the total', () => {
		expect(deriveBillingStatus(400, 1000)).toEqual({ status: 'partial', payment_status: 'pending' })
	})

	it('is paid/confirmed once the total is fully covered', () => {
		expect(deriveBillingStatus(1000, 1000)).toEqual({ status: 'paid', payment_status: 'confirmed' })
	})

	it('treats an overpayment defensively as paid/confirmed', () => {
		// paid > total is blocked upstream, but the helper must not produce a partial state.
		expect(deriveBillingStatus(1500, 1000)).toEqual({ status: 'paid', payment_status: 'confirmed' })
	})

	it('never derives overdue or canceled (read-time overlay / terminal state)', () => {
		const { status } = deriveBillingStatus(0, 1000)
		expect(status).not.toBe('overdue')
		expect(status).not.toBe('canceled')
	})

	it('keeps a zero-total, zero-paid charge pending', () => {
		expect(deriveBillingStatus(0, 0)).toEqual({ status: 'pending', payment_status: 'pending' })
	})
})
