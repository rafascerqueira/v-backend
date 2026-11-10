import { isOriginAllowed, resolveAllowedOrigins } from './allowed-origins'

const production = {
	corsOrigin: 'https://vendinhas.app, https://www.vendinhas.app',
	frontendUrl: 'https://vendinhas.app/',
	isProduction: true,
}

describe('allowed origins', () => {
	it('merges CORS_ORIGIN and FRONTEND_URL into one de-duplicated list of bare origins', () => {
		expect(resolveAllowedOrigins(production)).toEqual([
			'https://vendinhas.app',
			'https://www.vendinhas.app',
		])
	})

	it('ignores empty and malformed entries', () => {
		expect(
			resolveAllowedOrigins({ corsOrigin: ' , not a url,', frontendUrl: '', isProduction: true }),
		).toEqual([])
	})

	it.each(['https://vendinhas.app', 'https://www.vendinhas.app'])('allows %s', (origin) => {
		expect(isOriginAllowed(origin, production)).toBe(true)
	})

	it.each([
		'https://evil.example',
		'https://vendinhas.app.evil.example',
		'http://vendinhas.app',
		'https://vendinhas.app:8443',
		'null',
		'',
	])('refuses %p', (origin) => {
		expect(isOriginAllowed(origin, production)).toBe(false)
	})

	it("trusts the API's own origin (Swagger UI) outside production only", () => {
		const input = { corsOrigin: 'http://localhost:3000', apiUrl: 'http://localhost:3001' }

		expect(isOriginAllowed('http://localhost:3001', { ...input, isProduction: false })).toBe(true)
		expect(isOriginAllowed('http://localhost:3001', { ...input, isProduction: true })).toBe(false)
	})

	it('refuses loopback origins in production', () => {
		expect(isOriginAllowed('http://127.0.0.1:3000', production)).toBe(false)
	})

	it('allows loopback origins outside production (any port)', () => {
		const dev = { corsOrigin: 'http://localhost:3000', frontendUrl: undefined, isProduction: false }

		expect(isOriginAllowed('http://127.0.0.1:3000', dev)).toBe(true)
		expect(isOriginAllowed('http://127.0.0.1:5173', dev)).toBe(true)
		expect(isOriginAllowed('http://localhost:3000', dev)).toBe(true)
		expect(isOriginAllowed('http://localhost:9999', dev)).toBe(false)
		expect(isOriginAllowed('https://evil.example', dev)).toBe(false)
	})
})
