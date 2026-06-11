/**
 * CsrfGuard unit tests — double-submit cookie validation.
 */
import { ForbiddenException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { AUTH_COOKIES, CSRF_HEADER } from '../constants/cookies'
import { CsrfGuard } from './csrf.guard'

function makeContext(req: any, skip = false): any {
	return {
		switchToHttp: () => ({ getRequest: () => req }),
		getHandler: () => null,
		getClass: () => null,
		__skip: skip,
	}
}

describe('CsrfGuard', () => {
	let guard: CsrfGuard
	let reflector: { getAllAndOverride: jest.Mock }

	beforeEach(() => {
		reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) }
		guard = new CsrfGuard(reflector as unknown as Reflector)
	})

	const token = 'a'.repeat(64)
	const cookieAuth = (extra: Record<string, string> = {}) => ({
		[AUTH_COOKIES.ACCESS_TOKEN]: 'jwt',
		...extra,
	})

	it('allows safe methods without a token', () => {
		expect(guard.canActivate(makeContext({ method: 'GET', headers: {}, cookies: {} }))).toBe(true)
	})

	it('allows @Public() routes even with a session cookie (login/register/logout deadlock fix)', () => {
		// First reflector lookup is IS_PUBLIC_KEY -> true
		reflector.getAllAndOverride.mockReturnValueOnce(true)
		const req = { method: 'POST', headers: {}, cookies: cookieAuth() }
		expect(guard.canActivate(makeContext(req))).toBe(true)
	})

	it('allows @SkipCsrf() routes', () => {
		// IS_PUBLIC_KEY -> false, then SKIP_CSRF_KEY -> true
		reflector.getAllAndOverride.mockReturnValueOnce(false).mockReturnValueOnce(true)
		const req = { method: 'POST', headers: {}, cookies: cookieAuth() }
		expect(guard.canActivate(makeContext(req))).toBe(true)
	})

	it('allows Bearer-authenticated requests (non-ambient credential)', () => {
		const req = { method: 'POST', headers: { authorization: 'Bearer xyz' }, cookies: {} }
		expect(guard.canActivate(makeContext(req))).toBe(true)
	})

	it('allows unauthenticated requests (no session cookie to abuse)', () => {
		const req = { method: 'POST', headers: {}, cookies: {} }
		expect(guard.canActivate(makeContext(req))).toBe(true)
	})

	it('passes when the header matches the CSRF cookie', () => {
		const req = {
			method: 'POST',
			headers: { [CSRF_HEADER]: token },
			cookies: cookieAuth({ [AUTH_COOKIES.CSRF_TOKEN]: token }),
		}
		expect(guard.canActivate(makeContext(req))).toBe(true)
	})

	it('rejects a cookie-auth mutation with no CSRF header', () => {
		const req = {
			method: 'POST',
			headers: {},
			cookies: cookieAuth({ [AUTH_COOKIES.CSRF_TOKEN]: token }),
		}
		expect(() => guard.canActivate(makeContext(req))).toThrow(ForbiddenException)
	})

	it('rejects when header and cookie tokens differ', () => {
		const req = {
			method: 'POST',
			headers: { [CSRF_HEADER]: 'b'.repeat(64) },
			cookies: cookieAuth({ [AUTH_COOKIES.CSRF_TOKEN]: token }),
		}
		expect(() => guard.canActivate(makeContext(req))).toThrow(ForbiddenException)
	})
})
