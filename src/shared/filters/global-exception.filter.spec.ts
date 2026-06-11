/**
 * GlobalExceptionFilter unit tests
 *
 * Two security-relevant guarantees this filter must enforce:
 *
 *  1. In production, internal error details (stack traces, raw messages) MUST NOT
 *     leak into the HTTP response body. A regression here turns every uncaught
 *     bug into an information disclosure.
 *  2. The server-side log MUST still capture the real error — losing observability
 *     is just as bad as leaking it.
 *
 * Also covers Prisma error-code → HTTP-status mapping, because those codes are
 * what we rely on instead of duplicating uniqueness/existence checks in services.
 */

import type { ArgumentsHost } from '@nestjs/common'
import { BadRequestException, HttpException, HttpStatus, Logger } from '@nestjs/common'
import { GlobalExceptionFilter } from './global-exception.filter'

function makeHost(url = '/api/things') {
	const status = jest.fn().mockReturnThis()
	const send = jest.fn().mockReturnThis()
	const response = { status, send }
	const request = { url }

	const host = {
		switchToHttp: () => ({
			getResponse: () => response,
			getRequest: () => request,
		}),
	} as unknown as ArgumentsHost

	return { host, status, send, response, request }
}

describe('GlobalExceptionFilter', () => {
	let filter: GlobalExceptionFilter
	let originalNodeEnv: string | undefined

	beforeEach(() => {
		filter = new GlobalExceptionFilter()
		originalNodeEnv = process.env.NODE_ENV
		// Silence the Logger so the test output stays clean. We still verify it is called.
		jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
	})

	afterEach(() => {
		if (originalNodeEnv === undefined) {
			delete process.env.NODE_ENV
		} else {
			process.env.NODE_ENV = originalNodeEnv
		}
		jest.restoreAllMocks()
	})

	describe('HttpException passthrough', () => {
		it('uses the exception status and string body verbatim', () => {
			const { host, status, send } = makeHost('/api/x')
			const exception = new HttpException('Custom message', HttpStatus.FORBIDDEN)

			filter.catch(exception, host)

			expect(status).toHaveBeenCalledWith(403)
			expect(send).toHaveBeenCalledWith(
				expect.objectContaining({
					statusCode: 403,
					message: 'Custom message',
					path: '/api/x',
				}),
			)
		})

		it('extracts message/error/details from an object body', () => {
			const { host, send } = makeHost()
			const exception = new HttpException(
				{ message: 'Validation failed', error: 'BadRequest', details: { field: 'name' } },
				HttpStatus.BAD_REQUEST,
			)

			filter.catch(exception, host)

			expect(send).toHaveBeenCalledWith(
				expect.objectContaining({
					statusCode: 400,
					message: 'Validation failed',
					error: 'BadRequest',
					details: { field: 'name' },
				}),
			)
		})

		it('omits the `details` field when the exception does not provide one', () => {
			const { host, send } = makeHost()

			filter.catch(new BadRequestException('Bad'), host)

			const body = send.mock.calls[0][0]
			expect(body).not.toHaveProperty('details')
		})
	})

	describe('non-HttpException — production safety', () => {
		it('does NOT leak the original error message in production', () => {
			process.env.NODE_ENV = 'production'
			const { host, status, send } = makeHost()
			const leaky = new Error('DB connection string: postgres://user:secret@host')

			filter.catch(leaky, host)

			expect(status).toHaveBeenCalledWith(500)
			const body = send.mock.calls[0][0]
			expect(body.message).toBe('Internal server error')
			expect(body.error).toBe('Internal Server Error')
			expect(JSON.stringify(body)).not.toContain('secret')
		})

		it('still logs the real error server-side in production (observability)', () => {
			process.env.NODE_ENV = 'production'
			const errorSpy = jest.spyOn(Logger.prototype, 'error')
			const { host } = makeHost()
			const leaky = new Error('something exploded')

			filter.catch(leaky, host)

			expect(errorSpy).toHaveBeenCalled()
			expect(errorSpy.mock.calls[0][0] as string).toContain('something exploded')
		})

		it('exposes the real error in non-production for debuggability', () => {
			process.env.NODE_ENV = 'development'
			const { host, send } = makeHost()

			filter.catch(new Error('boom — readable in dev'), host)

			const body = send.mock.calls[0][0]
			expect(body.message).toBe('boom — readable in dev')
		})
	})

	describe('Prisma error-code mapping', () => {
		it('maps P2002 (unique constraint) to 409 Conflict', () => {
			const { host, status, send } = makeHost()
			const prismaErr = Object.assign(new Error('unique violation'), { code: 'P2002' })

			filter.catch(prismaErr, host)

			expect(status).toHaveBeenCalledWith(409)
			expect(send).toHaveBeenCalledWith(
				expect.objectContaining({ statusCode: 409, message: 'Registro duplicado' }),
			)
		})

		it('maps P2025 (record not found) to 404 Not Found', () => {
			const { host, status, send } = makeHost()
			const prismaErr = Object.assign(new Error('not found'), { code: 'P2025' })

			filter.catch(prismaErr, host)

			expect(status).toHaveBeenCalledWith(404)
			expect(send).toHaveBeenCalledWith(
				expect.objectContaining({ statusCode: 404, message: 'Registro não encontrado' }),
			)
		})

		it('keeps the Prisma mapping even in production (does not get re-clamped to 500)', () => {
			process.env.NODE_ENV = 'production'
			const { host, status } = makeHost()
			const prismaErr = Object.assign(new Error('unique'), { code: 'P2002' })

			filter.catch(prismaErr, host)

			expect(status).toHaveBeenCalledWith(409)
		})
	})

	describe('response envelope shape', () => {
		it('always includes statusCode, timestamp (ISO), path, error, message', () => {
			const { host, send } = makeHost('/orders')

			filter.catch(new BadRequestException('Bad'), host)

			const body = send.mock.calls[0][0]
			expect(body).toEqual(
				expect.objectContaining({
					statusCode: 400,
					timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/),
					path: '/orders',
					error: expect.any(String),
					message: expect.any(String),
				}),
			)
		})
	})
})
