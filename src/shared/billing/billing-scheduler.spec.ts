/**
 * billing-scheduler.computeDueDate unit tests
 *
 * This pure function feeds every recurring billing creation. A regression =
 * customers billed on the wrong day = lost revenue or angry support tickets.
 * Each branch + boundary is covered explicitly.
 *
 * All tests pass an explicit `reference` Date to keep them deterministic across
 * time zones and clocks.
 */
import { computeDueDate } from './billing-scheduler'

describe('computeDueDate', () => {
	describe('per_sale', () => {
		it('uses the sale date (reference) as the due date', () => {
			const due = computeDueDate('per_sale', null, new Date(2026, 5, 4, 12, 0, 0))
			expect(due).not.toBeNull()
			expect(due?.getFullYear()).toBe(2026)
			expect(due?.getMonth()).toBe(5)
			expect(due?.getDate()).toBe(4)
		})

		it('zeroes the time component (local midnight)', () => {
			const due = computeDueDate('per_sale', null, new Date(2026, 5, 4, 14, 37, 22))
			expect(due?.getHours()).toBe(0)
			expect(due?.getMinutes()).toBe(0)
			expect(due?.getSeconds()).toBe(0)
		})
	})

	describe('custom', () => {
		it('returns null (seller sets the date manually)', () => {
			expect(computeDueDate('custom', 10, new Date('2026-06-04T12:00:00Z'))).toBeNull()
		})
	})

	describe('weekly', () => {
		it('defaults to Monday when billingDay is null', () => {
			// 2026-06-04 is a Thursday (day 4). Next Monday is 2026-06-08.
			const due = computeDueDate('weekly', null, new Date(2026, 5, 4, 12, 0, 0))
			expect(due).not.toBeNull()
			expect(due?.getDay()).toBe(1)
			expect(due?.getDate()).toBe(8)
		})

		it('targets the requested day of week', () => {
			// Reference Thursday (day 4). Target Saturday (day 6) → 2 days later.
			const due = computeDueDate('weekly', 6, new Date(2026, 5, 4, 12, 0, 0))
			expect(due?.getDay()).toBe(6)
			expect(due?.getDate()).toBe(6)
		})

		it('rolls forward 7 days when target == reference day (never schedules today)', () => {
			// Reference Thursday (day 4), target Thursday → 7 days, not 0.
			const due = computeDueDate('weekly', 4, new Date(2026, 5, 4, 12, 0, 0))
			expect(due?.getDay()).toBe(4)
			expect(due?.getDate()).toBe(11)
		})

		it('zeroes the time component (midnight)', () => {
			const due = computeDueDate('weekly', 1, new Date(2026, 5, 4, 14, 37, 22))
			expect(due?.getHours()).toBe(0)
			expect(due?.getMinutes()).toBe(0)
			expect(due?.getSeconds()).toBe(0)
		})
	})

	describe('biweekly', () => {
		it('returns reference + 14 days', () => {
			const due = computeDueDate('biweekly', null, new Date(2026, 5, 4, 12, 0, 0))
			expect(due?.getDate()).toBe(18)
			expect(due?.getMonth()).toBe(5)
		})

		it('crosses the month boundary correctly', () => {
			const due = computeDueDate('biweekly', null, new Date(2026, 5, 20, 12, 0, 0))
			// 2026-06-20 + 14 = 2026-07-04
			expect(due?.getMonth()).toBe(6)
			expect(due?.getDate()).toBe(4)
		})

		it('zeroes the time component', () => {
			const due = computeDueDate('biweekly', null, new Date(2026, 5, 4, 23, 59, 59))
			expect(due?.getHours()).toBe(0)
		})
	})

	describe('monthly', () => {
		it('defaults to day 5 of the next occurrence when billingDay is null', () => {
			// Reference 2026-06-04 → day 5 has not passed → due 2026-06-05
			const due = computeDueDate('monthly', null, new Date(2026, 5, 4, 12, 0, 0))
			expect(due?.getDate()).toBe(5)
			expect(due?.getMonth()).toBe(5)
		})

		it('rolls to next month when the target day has already passed', () => {
			// Reference 2026-06-10, target day 5 → already past in June → due 2026-07-05
			const due = computeDueDate('monthly', 5, new Date(2026, 5, 10, 12, 0, 0))
			expect(due?.getDate()).toBe(5)
			expect(due?.getMonth()).toBe(6)
		})

		it('clamps day 31 to the last day of April (30) — never spills into May', () => {
			// REGRESSION GUARD: previous implementation used Date.setDate(31) which
			// rolled "Apr 31" → May 1 and silently skipped April entirely.
			const due = computeDueDate('monthly', 31, new Date(2026, 3, 10, 12, 0, 0))
			expect(due?.getMonth()).toBe(3) // April
			expect(due?.getDate()).toBe(30)
		})

		it('clamps day 31 to the last day of February in a non-leap year (28)', () => {
			// 2026 is not a leap year.
			const due = computeDueDate('monthly', 31, new Date(2026, 1, 5, 12, 0, 0))
			expect(due?.getMonth()).toBe(1) // February
			expect(due?.getDate()).toBe(28)
		})

		it('clamps day 31 to February 29 in a leap year', () => {
			// 2028 is a leap year.
			const due = computeDueDate('monthly', 31, new Date(2028, 1, 5, 12, 0, 0))
			expect(due?.getMonth()).toBe(1) // February
			expect(due?.getDate()).toBe(29)
		})

		it('respects day 31 when the target month actually has 31 days', () => {
			const due = computeDueDate('monthly', 31, new Date(2026, 0, 10, 12, 0, 0))
			expect(due?.getMonth()).toBe(0) // January
			expect(due?.getDate()).toBe(31)
		})

		it('treats "today is exactly billing day" as already passed (rolls forward)', () => {
			const due = computeDueDate('monthly', 5, new Date(2026, 5, 5, 0, 0, 0))
			expect(due?.getMonth()).toBe(6) // July
			expect(due?.getDate()).toBe(5)
		})

		it('rolls across the year boundary (Dec → Jan)', () => {
			// Reference 2026-12-20, target day 5 → already passed in Dec → Jan 5, 2027
			const due = computeDueDate('monthly', 5, new Date(2026, 11, 20, 12, 0, 0))
			expect(due?.getFullYear()).toBe(2027)
			expect(due?.getMonth()).toBe(0)
			expect(due?.getDate()).toBe(5)
		})

		it('zeroes the time component', () => {
			const due = computeDueDate('monthly', 15, new Date(2026, 5, 4, 14, 37, 22))
			expect(due?.getHours()).toBe(0)
			expect(due?.getMinutes()).toBe(0)
		})
	})
})
