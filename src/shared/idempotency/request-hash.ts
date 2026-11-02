import { createHash } from 'node:crypto'

/**
 * SHA-256 of the canonical JSON of a (validated) request body: object keys sorted at
 * every level and undefined members dropped, so the same logical body always hashes
 * the same regardless of key order.
 */
export function hashRequest(body: unknown): string {
	return createHash('sha256').update(canonicalJson(body)).digest('hex')
}

function canonicalJson(value: unknown): string {
	if (value === null || typeof value !== 'object') {
		return JSON.stringify(value) ?? 'null'
	}
	if (Array.isArray(value)) {
		return `[${value.map((item) => (item === undefined ? 'null' : canonicalJson(item))).join(',')}]`
	}
	const entries = Object.entries(value as Record<string, unknown>)
		.filter(([, member]) => member !== undefined)
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
	return `{${entries.map(([key, member]) => `${JSON.stringify(key)}:${canonicalJson(member)}`).join(',')}}`
}
