/**
 * Escape user-controlled text before interpolating it into an HTML string
 * (e.g. transactional email bodies built by raw template literals).
 *
 * The web UI is protected by React's automatic escaping, but server-side HTML
 * built by string concatenation is not — without this, a value like
 * `<img src=x onerror=…>` in a name would be injected into the markup.
 */
export function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;')
}
