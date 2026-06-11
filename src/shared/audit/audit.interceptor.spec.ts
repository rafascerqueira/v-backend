/**
 * AuditInterceptor unit tests
 * Covers: method filtering, path filtering, entity/entityId extraction, body sanitisation
 */

import type { CallHandler, ExecutionContext } from '@nestjs/common'
import { of } from 'rxjs'
import { AuditInterceptor } from './audit.interceptor'

const auditServiceMock = { log: jest.fn() }

function makeContext(method: string, url: string, body: unknown = {}, user?: { sub: string }) {
	const request = {
		method,
		url,
		body,
		ip: '127.0.0.1',
		headers: { 'user-agent': 'jest' },
		user,
	}
	return {
		switchToHttp: () => ({ getRequest: () => request }),
	} as unknown as ExecutionContext
}

const nextHandler: CallHandler = { handle: () => of({ ok: true }) }

describe('AuditInterceptor', () => {
	let interceptor: AuditInterceptor

	beforeEach(() => {
		interceptor = new AuditInterceptor(auditServiceMock as any)
		jest.clearAllMocks()
	})

	it('should pass through GET requests without logging', (done) => {
		const ctx = makeContext('GET', '/products')
		interceptor.intercept(ctx, nextHandler).subscribe(() => {
			expect(auditServiceMock.log).not.toHaveBeenCalled()
			done()
		})
	})

	it('should log CREATE for POST requests', (done) => {
		const ctx = makeContext('POST', '/products', { name: 'Widget' }, { sub: 'user-1' })
		interceptor.intercept(ctx, nextHandler).subscribe(() => {
			expect(auditServiceMock.log).toHaveBeenCalledWith(
				expect.objectContaining({ action: 'CREATE', entity: 'products', userId: 'user-1' }),
			)
			done()
		})
	})

	it('should log UPDATE for PATCH requests', (done) => {
		const ctx = makeContext('PATCH', '/products/5', { name: 'Updated' })
		interceptor.intercept(ctx, nextHandler).subscribe(() => {
			expect(auditServiceMock.log).toHaveBeenCalledWith(
				expect.objectContaining({ action: 'UPDATE', entity: 'products', entityId: '5' }),
			)
			done()
		})
	})

	it('should log UPDATE for PUT requests', (done) => {
		const ctx = makeContext('PUT', '/orders/10', { status: 'paid' })
		interceptor.intercept(ctx, nextHandler).subscribe(() => {
			expect(auditServiceMock.log).toHaveBeenCalledWith(
				expect.objectContaining({ action: 'UPDATE', entity: 'orders', entityId: '10' }),
			)
			done()
		})
	})

	it('should log DELETE for DELETE requests', (done) => {
		const ctx = makeContext('DELETE', '/products/42')
		interceptor.intercept(ctx, nextHandler).subscribe(() => {
			expect(auditServiceMock.log).toHaveBeenCalledWith(
				expect.objectContaining({
					action: 'DELETE',
					entity: 'products',
					entityId: '42',
					newValue: undefined,
				}),
			)
			done()
		})
	})

	it('should ignore /auth/login', (done) => {
		const ctx = makeContext('POST', '/auth/login', { email: 'a@b.com', password: 'secret' })
		interceptor.intercept(ctx, nextHandler).subscribe(() => {
			expect(auditServiceMock.log).not.toHaveBeenCalled()
			done()
		})
	})

	it('should ignore /health', (done) => {
		const ctx = makeContext('POST', '/health')
		interceptor.intercept(ctx, nextHandler).subscribe(() => {
			expect(auditServiceMock.log).not.toHaveBeenCalled()
			done()
		})
	})

	it('should strip query params when matching ignored paths', (done) => {
		const ctx = makeContext('POST', '/auth/login?redirect=/dashboard', {})
		interceptor.intercept(ctx, nextHandler).subscribe(() => {
			expect(auditServiceMock.log).not.toHaveBeenCalled()
			done()
		})
	})

	it('should redact sensitive keys from body', (done) => {
		const ctx = makeContext('POST', '/users', { name: 'Alice', password: 'secret', token: 'tok' })
		interceptor.intercept(ctx, nextHandler).subscribe(() => {
			const logged = auditServiceMock.log.mock.calls[0][0]
			expect(logged.newValue).toEqual({
				name: 'Alice',
				password: '[REDACTED]',
				token: '[REDACTED]',
			})
			done()
		})
	})

	it('should extract entity from nested path /products/5/prices/2', (done) => {
		const ctx = makeContext('PATCH', '/products/5/prices/2', {})
		interceptor.intercept(ctx, nextHandler).subscribe(() => {
			expect(auditServiceMock.log).toHaveBeenCalledWith(
				expect.objectContaining({ entity: 'products/prices', entityId: '2' }),
			)
			done()
		})
	})

	it('should handle missing user gracefully', (done) => {
		const ctx = makeContext('POST', '/products', { name: 'Widget' })
		interceptor.intercept(ctx, nextHandler).subscribe(() => {
			expect(auditServiceMock.log).toHaveBeenCalledWith(
				expect.objectContaining({ userId: undefined }),
			)
			done()
		})
	})
})
