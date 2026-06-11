/**
 * TenantContext unit tests
 *
 * This sits at the heart of multi-tenancy. If any of these contracts break, repos
 * scoped by sellerId can leak data across tenants, so each helper has an explicit
 * test rather than relying on transitive coverage from interceptor/middleware specs.
 */
import { TenantContext } from './tenant.context'

describe('TenantContext', () => {
	let ctx: TenantContext

	beforeEach(() => {
		ctx = new TenantContext()
	})

	it('returns undefined when called outside any run()', () => {
		expect(ctx.get()).toBeUndefined()
		expect(ctx.getSellerId()).toBeUndefined()
		expect(ctx.getRole()).toBeUndefined()
		expect(ctx.isAdmin()).toBe(false)
	})

	it('exposes the tenant data inside the run callback', () => {
		ctx.run({ sellerId: 'seller-1', role: 'seller' }, () => {
			expect(ctx.get()).toEqual({ sellerId: 'seller-1', role: 'seller' })
			expect(ctx.getSellerId()).toBe('seller-1')
			expect(ctx.getRole()).toBe('seller')
			expect(ctx.isAdmin()).toBe(false)
		})
	})

	it('isAdmin() is true only when role === "admin"', () => {
		ctx.run({ sellerId: 's1', role: 'admin' }, () => {
			expect(ctx.isAdmin()).toBe(true)
		})
		ctx.run({ sellerId: 's1', role: 'seller' }, () => {
			expect(ctx.isAdmin()).toBe(false)
		})
		// Defensive: anything else is not admin
		ctx.run({ sellerId: 's1', role: 'ADMIN' }, () => {
			expect(ctx.isAdmin()).toBe(false)
		})
	})

	it('requireSellerId() throws when no context is set', () => {
		expect(() => ctx.requireSellerId()).toThrow(/Tenant context not initialized/)
	})

	it('requireSellerId() returns the id inside a run', () => {
		ctx.run({ sellerId: 'seller-42', role: 'seller' }, () => {
			expect(ctx.requireSellerId()).toBe('seller-42')
		})
	})

	it('context does not leak past the callback boundary', () => {
		ctx.run({ sellerId: 's1', role: 'seller' }, () => {
			expect(ctx.getSellerId()).toBe('s1')
		})
		expect(ctx.getSellerId()).toBeUndefined()
	})

	it('concurrent async runs are isolated (AsyncLocalStorage guarantee)', async () => {
		const observed: string[] = []

		const run = (sellerId: string, delay: number) =>
			new Promise<void>((resolve) => {
				ctx.run({ sellerId, role: 'seller' }, () => {
					setTimeout(() => {
						observed.push(`${sellerId}:${ctx.getSellerId()}`)
						resolve()
					}, delay)
				})
			})

		await Promise.all([run('seller-A', 20), run('seller-B', 10), run('seller-C', 0)])

		// Each scheduled callback must see its OWN sellerId, regardless of interleaving.
		expect(observed.sort()).toEqual(['seller-A:seller-A', 'seller-B:seller-B', 'seller-C:seller-C'])
	})

	it('nested runs override the outer scope only within the inner callback', () => {
		ctx.run({ sellerId: 'outer', role: 'seller' }, () => {
			expect(ctx.getSellerId()).toBe('outer')
			ctx.run({ sellerId: 'inner', role: 'admin' }, () => {
				expect(ctx.getSellerId()).toBe('inner')
				expect(ctx.isAdmin()).toBe(true)
			})
			expect(ctx.getSellerId()).toBe('outer')
			expect(ctx.isAdmin()).toBe(false)
		})
	})
})
