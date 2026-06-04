import type { BillingMode } from '../repositories/customer.repository'

/**
 * Computes the due date for a billing based on the customer's billing mode.
 *
 * @param mode       - Customer's billing mode
 * @param billingDay - Day of month (1–31) used for monthly mode; day of week (0–6) for weekly
 * @param reference  - Reference date (defaults to now)
 */
export function computeDueDate(
	mode: BillingMode,
	billingDay: number | null | undefined,
	reference: Date = new Date(),
): Date | null {
	switch (mode) {
		case 'per_sale':
			return null // seller collects manually on each visit

		case 'weekly': {
			// billingDay = 0 (Sun) … 6 (Sat); default Monday (1)
			const target = billingDay ?? 1
			const current = reference.getDay()
			const daysUntil = (target - current + 7) % 7 || 7 // always next occurrence, never today
			const d = new Date(reference)
			d.setDate(d.getDate() + daysUntil)
			d.setHours(0, 0, 0, 0)
			return d
		}

		case 'biweekly': {
			const d = new Date(reference)
			d.setDate(d.getDate() + 14)
			d.setHours(0, 0, 0, 0)
			return d
		}

		case 'monthly': {
			// Find next occurrence, clamping the day to the target month's last day so
			// billing_day=31 in February rolls to Feb 28/29 (not into March).
			// JS Date is unsafe here: setDate(31) on a 30-day month overflows to the next
			// month, which would silently skip the intended billing date — so we compute
			// year/month/day independently and only build the Date at the end.
			const day = billingDay ?? 5
			let year = reference.getFullYear()
			let month = reference.getMonth()
			const lastDayThisMonth = new Date(year, month + 1, 0).getDate()
			const candidate = new Date(year, month, Math.min(day, lastDayThisMonth), 0, 0, 0, 0)
			if (candidate > reference) return candidate
			month += 1
			if (month > 11) {
				month = 0
				year += 1
			}
			const lastDayNext = new Date(year, month + 1, 0).getDate()
			return new Date(year, month, Math.min(day, lastDayNext), 0, 0, 0, 0)
		}

		case 'custom':
			return null // seller sets manually
	}
}
