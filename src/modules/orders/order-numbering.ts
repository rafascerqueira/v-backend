/**
 * Server-side order numbering (Phase 1A). One per-seller counter numbers the order
 * and its per-sale charge alike: PED-000123 / COB-000123 (at least 6 digits).
 */
const MIN_DIGITS = 6

export function orderNumberFor(sequence: number): string {
	return `PED-${String(sequence).padStart(MIN_DIGITS, '0')}`
}

export function billingNumberFor(sequence: number): string {
	return `COB-${String(sequence).padStart(MIN_DIGITS, '0')}`
}

/**
 * True for numbers in the sequential format. They are guessable, so the public
 * tracking route must never resolve an order by one of them (it uses the
 * tracking token instead).
 */
export function isSequentialOrderNumber(value: string): boolean {
	return /^PED-\d+$/.test(value)
}
