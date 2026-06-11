/**
 * TenantInterceptor unit tests
 *
 * The interceptor binds the request's user identity into the AsyncLocalStorage
 * tenant context for the duration of the handler chain. A regression here means
 * downstream repositories see `undefined` sellerId (silent failure) or — worse —
 * the wrong sellerId, leading to cross-tenant reads/writes.
 */
import type { CallHandler, ExecutionContext } from '@nestjs/common'
import { firstValueFrom, of, throwError } from 'rxjs'
import { TenantContext } from './tenant.context'
import { TenantInterceptor } from './tenant.interceptor'

function makeContext(user: unknown): ExecutionContext {
	return {
		switchToHttp: () => ({
			getRequest: () => ({ user }),
		}),
	} as unknown as ExecutionContext
}

describe('TenantInterceptor', () => {
	let interceptor: TenantInterceptor
	let tenantContext: TenantContext

	beforeEach(() => {
		interceptor = new TenantInterceptor()
		tenantContext = new TenantContext()
	})

	it('runs the downstream handler inside the tenant context when user is present', async () => {
		const observed: { current: string | undefined } = { current: undefined }
		const handler: CallHandler = {
			handle: () => {
				// Read the sellerId at the moment the handler is invoked
				observed.current = tenantContext.getSellerId()
				return of('ok')
			},
		}

		const ctx = makeContext({ sub: 'seller-1', role: 'seller' })
		const result = await firstValueFrom(interceptor.intercept(ctx, handler))

		expect(result).toBe('ok')
		expect(observed.current).toBe('seller-1')
	})

	it('does NOT bind a context when the request has no user (public route)', async () => {
		const observed: { current: string | undefined } = { current: 'leak-canary' }
		const handler: CallHandler = {
			handle: () => {
				observed.current = tenantContext.getSellerId()
				return of('public-ok')
			},
		}

		const ctx = makeContext(undefined)
		const result = await firstValueFrom(interceptor.intercept(ctx, handler))

		expect(result).toBe('public-ok')
		expect(observed.current).toBeUndefined()
	})

	it('does NOT bind a context when user is missing role (defensive guard)', async () => {
		const observed: { current: string | undefined } = { current: 'leak-canary' }
		const handler: CallHandler = {
			handle: () => {
				observed.current = tenantContext.getSellerId()
				return of('ok')
			},
		}

		const ctx = makeContext({ sub: 'seller-1' })
		await firstValueFrom(interceptor.intercept(ctx, handler))

		expect(observed.current).toBeUndefined()
	})

	it('propagates the role through to isAdmin()', async () => {
		const observed: { admin: boolean } = { admin: false }
		const handler: CallHandler = {
			handle: () => {
				observed.admin = tenantContext.isAdmin()
				return of('ok')
			},
		}

		const ctx = makeContext({ sub: 'admin-1', role: 'admin' })
		await firstValueFrom(interceptor.intercept(ctx, handler))

		expect(observed.admin).toBe(true)
	})

	it('forwards handler errors without swallowing them', async () => {
		const handler: CallHandler = {
			handle: () => throwError(() => new Error('handler exploded')),
		}

		const ctx = makeContext({ sub: 'seller-1', role: 'seller' })

		await expect(firstValueFrom(interceptor.intercept(ctx, handler))).rejects.toThrow(
			'handler exploded',
		)
	})

	it('does not leak tenant context after the handler completes', async () => {
		const handler: CallHandler = { handle: () => of('ok') }
		const ctx = makeContext({ sub: 'seller-1', role: 'seller' })

		await firstValueFrom(interceptor.intercept(ctx, handler))

		expect(tenantContext.getSellerId()).toBeUndefined()
	})

	it('keeps concurrent requests isolated from each other', async () => {
		const observations: string[] = []

		const makeIsolatedHandler = (tag: string): CallHandler => ({
			handle: () =>
				new (require('rxjs').Observable)((subscriber: any) => {
					setTimeout(
						() => {
							observations.push(`${tag}:${tenantContext.getSellerId()}`)
							subscriber.next('ok')
							subscriber.complete()
						},
						Math.floor(Math.random() * 20),
					)
				}),
		})

		await Promise.all([
			firstValueFrom(
				interceptor.intercept(makeContext({ sub: 'A', role: 'seller' }), makeIsolatedHandler('A')),
			),
			firstValueFrom(
				interceptor.intercept(makeContext({ sub: 'B', role: 'seller' }), makeIsolatedHandler('B')),
			),
			firstValueFrom(
				interceptor.intercept(makeContext({ sub: 'C', role: 'seller' }), makeIsolatedHandler('C')),
			),
		])

		expect(observations.sort()).toEqual(['A:A', 'B:B', 'C:C'])
	})
})
