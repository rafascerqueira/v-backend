export const AUTH_COOKIES = {
	ACCESS_TOKEN: 'access_token',
	REFRESH_TOKEN: 'refresh_token',
	OAUTH_STATE: 'oauth_state',
	CSRF_TOKEN: 'csrf_token',
} as const

/** Header the SPA echoes the CSRF token back in (double-submit cookie pattern). */
export const CSRF_HEADER = 'x-csrf-token'

export interface CookieOptions {
	httpOnly: boolean
	secure: boolean
	sameSite: 'lax'
	path: string
	domain: string | undefined
	maxAge?: number
}

// IMPORTANT: cookie options are computed LAZILY, on every call, not frozen at
// module-load time.
//
// These are read from process.env (COOKIE_DOMAIN, NODE_ENV). main.ts calls
// loadEnvFile() before bootstrap, BUT ES `import` statements are hoisted above
// it — so anything evaluated at module-load time (e.g. `const x = configuration()`)
// reads process.env BEFORE the .env file is loaded. That is exactly what made
// COOKIE_DOMAIN come out `undefined` in the compiled bundle: the csrf_token cookie
// was issued without a domain, stayed pinned to api.vendinhas.app, and the SPA on
// vendinhas.app could not read it to echo X-CSRF-Token → 403 on every mutation.
//
// Reading env at call time (each setCookie) sidesteps import ordering entirely.
export function cookieOptions(): CookieOptions {
	return {
		httpOnly: true,
		secure: process.env.NODE_ENV === 'production',
		sameSite: 'lax',
		path: '/',
		domain: process.env.COOKIE_DOMAIN || undefined,
	}
}

export function oauthStateCookieOptions(): CookieOptions {
	return { ...cookieOptions(), maxAge: 600 }
}

// The CSRF token must be READABLE by JS so the SPA can copy it into the
// X-CSRF-Token header. It is not a secret in the XSS sense — its only job is to
// be unforgeable by a *cross-site* page, which can neither read this cookie nor
// set the matching header. Everything else mirrors the session cookie so it is
// scoped to the same hosts (COOKIE_DOMAIN) and only sent over HTTPS in prod.
export function csrfCookieOptions(): CookieOptions {
	return { ...cookieOptions(), httpOnly: false }
}
