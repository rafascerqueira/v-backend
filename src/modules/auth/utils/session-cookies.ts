import type { FastifyReply, FastifyRequest } from 'fastify'
import {
	AUTH_COOKIES,
	cookieOptions,
	csrfCookieOptions,
	refreshCookieOptions,
	sessionHintCookieOptions,
} from '../constants/cookies'
import type { IssuedSession } from '../session/session.types'
import { generateCsrfToken } from './csrf'

/**
 * Writes the cookies of a session that was just created or rotated.
 *
 * With "keep me signed in" every cookie lasts as long as the session may stay idle.
 * Without it they are browser-session cookies (no Max-Age): closing the browser ends
 * the session on that device.
 */
export function setSessionCookies(
	request: FastifyRequest,
	reply: FastifyReply,
	session: IssuedSession,
): void {
	const persistent = session.persistent
	const lifetime = persistent ? { maxAge: session.sessionTtl } : {}

	reply.setCookie(AUTH_COOKIES.ACCESS_TOKEN, session.accessToken, {
		...cookieOptions(),
		...(persistent ? { maxAge: session.expiresIn } : {}),
	})

	if (!session.refreshToken) {
		// Grace window: a concurrent refresh already rotated the session and its response
		// carries the new refresh, CSRF and hint cookies. Rewriting them here would race
		// that response (two CSRF values in flight -> a mismatched double-submit), so only
		// a missing CSRF cookie is seeded.
		if (!request.cookies?.[AUTH_COOKIES.CSRF_TOKEN]) {
			reply.setCookie(AUTH_COOKIES.CSRF_TOKEN, generateCsrfToken(), {
				...csrfCookieOptions(),
				...lifetime,
			})
		}
		return
	}

	reply.setCookie(AUTH_COOKIES.REFRESH_TOKEN, session.refreshToken, {
		...refreshCookieOptions(),
		...lifetime,
	})
	// The CSRF token rotates with the session and lives exactly as long as it can be
	// renewed; otherwise the next mutation would submit an empty header.
	reply.setCookie(AUTH_COOKIES.CSRF_TOKEN, generateCsrfToken(), {
		...csrfCookieOptions(),
		...lifetime,
	})
	reply.setCookie(AUTH_COOKIES.SESSION_HINT, '1', { ...sessionHintCookieOptions(), ...lifetime })
}

/** Removes every session cookie. Safe to call when none is set. */
export function clearSessionCookies(reply: FastifyReply): void {
	const base = cookieOptions()
	reply.clearCookie(AUTH_COOKIES.ACCESS_TOKEN, { ...base })
	reply.clearCookie(AUTH_COOKIES.REFRESH_TOKEN, { ...refreshCookieOptions() })
	// Refresh cookies issued before the path was narrowed were scoped to `/`.
	reply.clearCookie(AUTH_COOKIES.REFRESH_TOKEN, { ...base })
	reply.clearCookie(AUTH_COOKIES.CSRF_TOKEN, { ...csrfCookieOptions() })
	reply.clearCookie(AUTH_COOKIES.SESSION_HINT, { ...sessionHintCookieOptions() })
}

export function readSessionCookies(request: FastifyRequest): {
	accessToken?: string
	refreshToken?: string
} {
	return {
		accessToken: request.cookies?.[AUTH_COOKIES.ACCESS_TOKEN] || undefined,
		refreshToken: request.cookies?.[AUTH_COOKIES.REFRESH_TOKEN] || undefined,
	}
}
