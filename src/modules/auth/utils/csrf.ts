import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { FastifyReply } from 'fastify'
import { AUTH_COOKIES, CSRF_COOKIE_OPTIONS } from '../constants/cookies'

/** Cryptographically-random, unguessable CSRF token. */
export function generateCsrfToken(): string {
	return randomBytes(32).toString('hex')
}

/**
 * Issue a fresh CSRF token cookie alongside a session. Returns the token so the
 * caller may also expose it in the response body if desired.
 */
export function setCsrfCookie(reply: FastifyReply, maxAge: number): string {
	const token = generateCsrfToken()
	reply.setCookie(AUTH_COOKIES.CSRF_TOKEN, token, { ...CSRF_COOKIE_OPTIONS, maxAge })
	return token
}

/** Constant-time comparison that is also safe for unequal-length inputs. */
export function csrfTokensMatch(cookieToken?: string, headerToken?: string): boolean {
	if (!cookieToken || !headerToken) return false
	const a = Buffer.from(cookieToken)
	const b = Buffer.from(headerToken)
	if (a.length !== b.length) return false
	return timingSafeEqual(a, b)
}
