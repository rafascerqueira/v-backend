import configuration from '@/config/configuration'

export const AUTH_COOKIES = {
	ACCESS_TOKEN: 'access_token',
	REFRESH_TOKEN: 'refresh_token',
	OAUTH_STATE: 'oauth_state',
	CSRF_TOKEN: 'csrf_token',
} as const

/** Header the SPA echoes the CSRF token back in (double-submit cookie pattern). */
export const CSRF_HEADER = 'x-csrf-token'

const config = configuration()

export const COOKIE_OPTIONS = {
	httpOnly: true,
	secure: config.isProduction,
	sameSite: 'lax' as const,
	path: '/',
	domain: config.cookie.domain,
}

export const OAUTH_STATE_COOKIE_OPTIONS = {
	...COOKIE_OPTIONS,
	maxAge: 600,
}

// The CSRF token must be READABLE by JS so the SPA can copy it into the
// X-CSRF-Token header. It is not a secret in the XSS sense — its only job is to
// be unforgeable by a *cross-site* page, which can neither read this cookie nor
// set the matching header. Everything else mirrors the session cookie so it is
// scoped to the same hosts (COOKIE_DOMAIN) and only sent over HTTPS in prod.
export const CSRF_COOKIE_OPTIONS = {
	...COOKIE_OPTIONS,
	httpOnly: false,
}
