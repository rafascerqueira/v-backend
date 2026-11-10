import type { ConfigService } from '@nestjs/config'

export interface AllowedOriginsInput {
	/** CORS_ORIGIN: one origin or a comma-separated list (e.g. apex + www). */
	corsOrigin?: string
	/** FRONTEND_URL: the SPA origin, always allowed. */
	frontendUrl?: string
	/**
	 * APP_URL: the API's own origin. Trusted outside production only, where the API
	 * serves its Swagger UI and that page calls the API from the API's origin.
	 */
	apiUrl?: string
	isProduction: boolean
}

// Loopback origins are accepted outside production only, for local development.
const LOOPBACK_ORIGIN = /^http:\/\/127\.0\.0\.1:\d+$/

function toOrigin(value: string): string | null {
	const trimmed = value.trim()
	if (!trimmed) return null
	try {
		return new URL(trimmed).origin
	} catch {
		return null
	}
}

/**
 * The one list of browser origins the API trusts. CORS, the WebSocket handshake and
 * the Origin check on login/refresh all answer from this list, so they cannot drift
 * apart. Entries are normalized to a bare origin (scheme + host + port).
 */
export function resolveAllowedOrigins(input: AllowedOriginsInput): string[] {
	const candidates = [...(input.corsOrigin ?? '').split(','), input.frontendUrl ?? '']
	const origins = new Set<string>()
	for (const candidate of candidates) {
		const origin = toOrigin(candidate)
		if (origin) origins.add(origin)
	}
	return [...origins]
}

export function isOriginAllowed(origin: string, input: AllowedOriginsInput): boolean {
	const normalized = toOrigin(origin)
	if (!normalized) return false
	if (resolveAllowedOrigins(input).includes(normalized)) return true
	if (input.isProduction) return false
	return LOOPBACK_ORIGIN.test(normalized) || normalized === toOrigin(input.apiUrl ?? '')
}

/** Reads the origin settings at call time, so a late-loaded .env is honoured. */
export function allowedOriginsFromConfig(configService: ConfigService): AllowedOriginsInput {
	return {
		corsOrigin: configService.get<string>('cors.origin', 'http://localhost:3000'),
		frontendUrl: configService.get<string>('frontendUrl', 'http://localhost:3000'),
		apiUrl: configService.get<string>('appUrl', 'http://localhost:3001'),
		isProduction: configService.get<boolean>('isProduction', false),
	}
}
