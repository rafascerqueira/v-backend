import {
	type CanActivate,
	type ExecutionContext,
	ForbiddenException,
	Injectable,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { AUTH_COOKIES, CSRF_HEADER } from '../constants/cookies'
import { IS_PUBLIC_KEY } from '../decorators/public.decorator'
import { SKIP_CSRF_KEY } from '../decorators/skip-csrf.decorator'
import { csrfTokensMatch } from '../utils/csrf'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * Double-submit CSRF protection.
 *
 * A cross-site page can make the browser send our cookies, but it can neither
 * read the (JS-readable, non-HttpOnly) CSRF cookie nor set a custom request
 * header. So for any state-changing request authenticated by the *ambient*
 * session cookie, we require the X-CSRF-Token header to match the CSRF cookie.
 *
 * Exemptions (no CSRF risk to defend against):
 *  - Safe methods (GET/HEAD/OPTIONS) never mutate state.
 *  - Bearer-token requests: the token is set explicitly by the client, not
 *    attached ambiently by the browser, so a cross-site page can't forge it.
 *  - Requests with no session cookie: nothing to ride on.
 *  - Routes explicitly marked @SkipCsrf() (e.g. signature-verified webhooks).
 */
@Injectable()
export class CsrfGuard implements CanActivate {
	constructor(private readonly reflector: Reflector) {}

	canActivate(context: ExecutionContext): boolean {
		const request = context.switchToHttp().getRequest()
		const method = String(request.method ?? 'GET').toUpperCase()

		if (SAFE_METHODS.has(method)) return true

		// @Public() routes (login, register, forgot-password, …) don't authenticate
		// via the session — JwtAuthGuard is skipped and req.user is never set, so
		// there is no user action to forge. Gating them on CSRF would also deadlock
		// login whenever a stale access_token cookie lingers without a csrf cookie.
		const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
			context.getHandler(),
			context.getClass(),
		])
		if (isPublic) return true

		const skip = this.reflector.getAllAndOverride<boolean>(SKIP_CSRF_KEY, [
			context.getHandler(),
			context.getClass(),
		])
		if (skip) return true

		const authHeader: string | undefined = request.headers?.authorization
		if (authHeader?.startsWith('Bearer ')) return true

		const sessionCookie = request.cookies?.[AUTH_COOKIES.ACCESS_TOKEN]
		if (!sessionCookie) return true

		const cookieToken: string | undefined = request.cookies?.[AUTH_COOKIES.CSRF_TOKEN]
		const rawHeader = request.headers?.[CSRF_HEADER]
		const headerToken = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader

		if (!csrfTokensMatch(cookieToken, headerToken)) {
			throw new ForbiddenException('Invalid or missing CSRF token')
		}
		return true
	}
}
