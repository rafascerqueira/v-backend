/**
 * create-customer.dto validation tests
 *
 * billing_day is interpreted differently per billing_mode (see
 * shared/billing/billing-scheduler.ts):
 *   - per_sale / biweekly / custom: billing_day is irrelevant → coerced to null
 *   - weekly: billing_day is a day of week (0=Sunday … 6=Saturday)
 *   - monthly: billing_day is a day of month (1 … 31)
 *
 * These tests lock that contract so the DTO and the scheduler never drift apart.
 */
import { createCustomerSchema, updateCustomerSchema } from './create-customer.dto'

const validBase = {
	name: 'John Doe',
	phone: '11999999999',
	city: 'São Paulo',
	state: 'SP',
}

describe('createCustomerSchema billing rules', () => {
	describe('modes that ignore billing_day (coerced to null)', () => {
		it.each([
			'per_sale',
			'biweekly',
			'custom',
		] as const)('nulls billing_day for %s even when a value is sent', (billing_mode) => {
			const result = createCustomerSchema.parse({
				...validBase,
				billing_mode,
				billing_day: 15,
			})
			expect(result.billing_day).toBeNull()
		})

		it('defaults to per_sale and nulls billing_day when billing_mode is omitted', () => {
			const result = createCustomerSchema.parse({ ...validBase, billing_day: 10 })
			expect(result.billing_day).toBeNull()
		})
	})

	describe('weekly (day of week 0–6)', () => {
		it('accepts Sunday (0)', () => {
			const result = createCustomerSchema.parse({
				...validBase,
				billing_mode: 'weekly',
				billing_day: 0,
			})
			expect(result.billing_day).toBe(0)
		})

		it('accepts Saturday (6)', () => {
			const result = createCustomerSchema.parse({
				...validBase,
				billing_mode: 'weekly',
				billing_day: 6,
			})
			expect(result.billing_day).toBe(6)
		})

		it('rejects a day of week greater than 6', () => {
			const result = createCustomerSchema.safeParse({
				...validBase,
				billing_mode: 'weekly',
				billing_day: 7,
			})
			expect(result.success).toBe(false)
			if (!result.success) {
				expect(result.error.issues[0]?.path).toContain('billing_day')
			}
		})

		it('allows weekly without billing_day (scheduler defaults to Monday)', () => {
			const result = createCustomerSchema.parse({
				...validBase,
				billing_mode: 'weekly',
			})
			expect(result.billing_day).toBeUndefined()
		})
	})

	describe('monthly (day of month 1–31)', () => {
		it('accepts the first day of the month (1)', () => {
			const result = createCustomerSchema.parse({
				...validBase,
				billing_mode: 'monthly',
				billing_day: 1,
			})
			expect(result.billing_day).toBe(1)
		})

		it('accepts the last possible day (31)', () => {
			const result = createCustomerSchema.parse({
				...validBase,
				billing_mode: 'monthly',
				billing_day: 31,
			})
			expect(result.billing_day).toBe(31)
		})

		it('rejects day 0 for monthly', () => {
			const result = createCustomerSchema.safeParse({
				...validBase,
				billing_mode: 'monthly',
				billing_day: 0,
			})
			expect(result.success).toBe(false)
			if (!result.success) {
				expect(result.error.issues[0]?.path).toContain('billing_day')
			}
		})

		it('rejects day 32 (out of the base 0–31 range)', () => {
			const result = createCustomerSchema.safeParse({
				...validBase,
				billing_mode: 'monthly',
				billing_day: 32,
			})
			expect(result.success).toBe(false)
		})

		it('allows monthly without billing_day (scheduler defaults to day 5)', () => {
			const result = createCustomerSchema.parse({
				...validBase,
				billing_mode: 'monthly',
			})
			expect(result.billing_day).toBeUndefined()
		})
	})
})

describe('updateCustomerSchema billing rules', () => {
	it('nulls billing_day when switching to per_sale', () => {
		const result = updateCustomerSchema.parse({ billing_mode: 'per_sale', billing_day: 5 })
		expect(result.billing_day).toBeNull()
	})

	it('keeps billing_day when only the day is updated (mode unknown at this layer)', () => {
		const result = updateCustomerSchema.parse({ billing_day: 3 })
		expect(result.billing_day).toBe(3)
	})

	it('validates the weekly range when mode is present', () => {
		const result = updateCustomerSchema.safeParse({ billing_mode: 'weekly', billing_day: 9 })
		expect(result.success).toBe(false)
	})

	it('accepts a valid weekly day on update', () => {
		const result = updateCustomerSchema.parse({ billing_mode: 'weekly', billing_day: 3 })
		expect(result.billing_day).toBe(3)
	})
})
