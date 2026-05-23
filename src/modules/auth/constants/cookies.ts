import configuration from '@/config/configuration'

export const AUTH_COOKIES = {
	ACCESS_TOKEN: 'access_token',
	REFRESH_TOKEN: 'refresh_token',
	OAUTH_STATE: 'oauth_state',
} as const

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
