const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

/** Formats integer cents as pt-BR currency ("R$ 14,90", with a non-breaking space). */
export function formatBRL(cents: number): string {
	return BRL.format(cents / 100)
}
