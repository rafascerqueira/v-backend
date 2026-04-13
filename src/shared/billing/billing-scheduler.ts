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
			const day = billingDay ?? 5
			const d = new Date(reference)
			d.setDate(day)
			d.setHours(0, 0, 0, 0)
			// If that day has already passed this month, move to next month
			if (d <= reference) {
				d.setMonth(d.getMonth() + 1)
			}
			// Clamp to last day of month (e.g., billing_day=31 in February)
			const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
			if (day > lastDay) d.setDate(lastDay)
			return d
		}

		case 'custom':
			return null // seller sets manually
	}
}
