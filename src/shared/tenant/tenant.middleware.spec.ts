/**
 * TenantMiddleware unit tests
 *
 * Mirrors the interceptor's contract but for the middleware lifecycle (runs
 * before guards/interceptors). A break here means downstream guards see the
 * wrong or missing tenant — same blast radius as the interceptor.
 */
import { TenantContext } from './tenant.context'
import { TenantMiddleware } from './tenant.middleware'

describe('TenantMiddleware', () => {
	let ctx: TenantContext
	let middleware: TenantMiddleware

	beforeEach(() => {
		ctx = new TenantContext()
		middleware = new TenantMiddleware(ctx)
	})

	it('runs next() inside the tenant context when user is on the request', () => {
		const req = { user: { sub: 'seller-7', role: 'seller' } } as never
		const observed: { sellerId: string | undefined } = { sellerId: undefined }

		middleware.use(req, {} as never, () => {
			observed.sellerId = ctx.getSellerId()
		})

		expect(observed.sellerId).toBe('seller-7')
	})

	it('calls next() outside any context when user is missing (public route)', () => {
		const req = {} as never
		const observed: { sellerId: string | undefined } = { sellerId: 'leak-canary' }

		middleware.use(req, {} as never, () => {
			observed.sellerId = ctx.getSellerId()
		})

		expect(observed.sellerId).toBeUndefined()
	})

	it('does not bind context when user is missing role (defensive)', () => {
		const req = { user: { sub: 'seller-1' } } as never
		const observed: { sellerId: string | undefined } = { sellerId: 'leak-canary' }

		middleware.use(req, {} as never, () => {
			observed.sellerId = ctx.getSellerId()
		})

		expect(observed.sellerId).toBeUndefined()
	})

	it('passes through the role for admin detection', () => {
		const req = { user: { sub: 'admin-1', role: 'admin' } } as never
		const observed: { admin: boolean } = { admin: false }

		middleware.use(req, {} as never, () => {
			observed.admin = ctx.isAdmin()
		})

		expect(observed.admin).toBe(true)
	})

	it('does not leak context after next() returns', () => {
		const req = { user: { sub: 'seller-1', role: 'seller' } } as never

		middleware.use(req, {} as never, () => {
			// no-op
		})

		expect(ctx.getSellerId()).toBeUndefined()
	})
})
