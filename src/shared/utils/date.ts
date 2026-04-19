/**
 * Parses a YYYY-MM-DD string as local midnight.
 * new Date("YYYY-MM-DD") parses as UTC midnight per the ECMAScript spec,
 * which shifts the stored instant by the server's UTC offset.
 */
export function parseLocalDate(dateStr: string): Date {
	const [year, month, day] = dateStr.split('-').map(Number)
	return new Date(year, month - 1, day, 0, 0, 0, 0)
}
