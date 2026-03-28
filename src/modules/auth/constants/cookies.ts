import configuration from '@/config/configuration'

export const AUTH_COOKIES = {
	ACCESS_TOKEN: 'access_token',
	REFRESH_TOKEN: 'refresh_token',
} as const

const config = configuration()

export const COOKIE_OPTIONS = {
	httpOnly: true,
	secure: config.isProduction,
	sameSite: 'strict' as const,
	path: '/',
}
