import { ForbiddenException } from '@nestjs/common'
import type { ConfigService } from '@nestjs/config'
import { OriginGuard } from './origin.guard'

function makeContext(headers: Record<string, unknown>): any {
	return { switchToHttp: () => ({ getRequest: () => ({ headers }) }) }
}

function makeGuard(isProduction = true) {
	const values: Record<string, unknown> = {
		'cors.origin': 'https://vendinhas.app',
		frontendUrl: 'https://vendinhas.app',
		isProduction,
	}
	const config = { get: jest.fn((key: string, fallback?: unknown) => values[key] ?? fallback) }
	return new OriginGuard(config as unknown as ConfigService)
}

describe('OriginGuard', () => {
	it('lets a request from the frontend origin through', () => {
		expect(makeGuard().canActivate(makeContext({ origin: 'https://vendinhas.app' }))).toBe(true)
	})

	it('lets a request without an Origin header through (not a browser page)', () => {
		expect(makeGuard().canActivate(makeContext({}))).toBe(true)
	})

	it('refuses a foreign origin with 403 ORIGIN_NOT_ALLOWED', () => {
		const guard = makeGuard()

		expect(() => guard.canActivate(makeContext({ origin: 'https://evil.example' }))).toThrow(
			ForbiddenException,
		)
		try {
			guard.canActivate(makeContext({ origin: 'https://evil.example' }))
		} catch (error) {
			expect((error as ForbiddenException).getResponse()).toMatchObject({
				code: 'ORIGIN_NOT_ALLOWED',
			})
		}
	})

	it('refuses the opaque "null" origin (sandboxed iframe, data: URL)', () => {
		expect(() => makeGuard().canActivate(makeContext({ origin: 'null' }))).toThrow(
			ForbiddenException,
		)
	})

	it('uses the first value when the header is repeated', () => {
		const guard = makeGuard()

		expect(() =>
			guard.canActivate(makeContext({ origin: ['https://evil.example', 'https://vendinhas.app'] })),
		).toThrow(ForbiddenException)
	})
})
