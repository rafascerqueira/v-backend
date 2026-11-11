const UNIT_SECONDS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 }

/**
 * Parses a duration such as `15m`, `12h` or `30d` into seconds. Anything that does
 * not match (or is not positive) yields `fallbackSeconds`.
 */
export function parseDurationSeconds(value: string | undefined, fallbackSeconds: number): number {
	const match = value?.trim().match(/^(\d+)([smhd])$/)
	if (!match) return fallbackSeconds
	const seconds = parseInt(match[1], 10) * UNIT_SECONDS[match[2]]
	return seconds > 0 ? seconds : fallbackSeconds
}
