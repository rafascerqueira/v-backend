import type { Prisma } from '@/generated/prisma/client'
import { formatBRL } from '@/shared/money/format-brl'
import { nextSellerSequenceValue } from '@/shared/sequences/seller-sequence'
import { billingNumberFor, isSequentialOrderNumber, orderNumberFor } from './order-numbering'

describe('order numbering', () => {
	it('pads to at least 6 digits and grows past them', () => {
		expect(orderNumberFor(1)).toBe('PED-000001')
		expect(orderNumberFor(123)).toBe('PED-000123')
		expect(orderNumberFor(1234567)).toBe('PED-1234567')
		expect(billingNumberFor(123)).toBe('COB-000123')
	})

	it.each(['PED-000001', 'PED-1', 'PED-1234567'])('treats %s as sequential (guessable)', (n) => {
		expect(isSequentialOrderNumber(n)).toBe(true)
	})

	it.each([
		'PED-202611-1234',
		'PED-MHZ3K2AB7Q',
		'ORD-001',
		'PED-',
	])('treats legacy %s as non-sequential', (n) => {
		expect(isSequentialOrderNumber(n)).toBe(false)
	})
})

describe('nextSellerSequenceValue', () => {
	it('bumps the counter with an upsert and returns the new value as a number', async () => {
		const $queryRaw = jest.fn().mockResolvedValue([{ value: 7 }])

		const value = await nextSellerSequenceValue(
			{ $queryRaw } as unknown as Prisma.TransactionClient,
			'seller-1',
			'order',
		)

		expect(value).toBe(7)
		const [sql, ...params] = $queryRaw.mock.calls[0]
		expect(sql.join('?')).toContain('ON CONFLICT (seller_id, name) DO UPDATE')
		expect(params).toEqual(['seller-1', 'order'])
	})
})

describe('formatBRL', () => {
	it('formats integer cents as pt-BR currency', () => {
		expect(formatBRL(12990)).toBe('R$ 129,90')
		expect(formatBRL(100000)).toBe('R$ 1.000,00')
		expect(formatBRL(0)).toBe('R$ 0,00')
	})
})
