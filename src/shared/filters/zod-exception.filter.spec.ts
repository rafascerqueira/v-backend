/**
 * ZodExceptionFilter unit tests
 *
 * Translates ZodError into a stable client-facing shape. The contract:
 *  - status is always 400
 *  - response has { statusCode, message, errors[] }
 *  - each `errors[]` entry has `{ field, message }` where `field` is the
 *    dotted path of the issue
 * Frontend code parses this exact shape — drifting silently here is a regression.
 */
import type { ArgumentsHost } from '@nestjs/common'
import { z } from 'zod'
import { ZodExceptionFilter } from './zod-exception.filter'

function makeHost() {
	const status = jest.fn().mockReturnThis()
	const send = jest.fn().mockReturnThis()
	const response = { status, send }

	const host = {
		switchToHttp: () => ({ getResponse: () => response }),
	} as unknown as ArgumentsHost

	return { host, status, send }
}

describe('ZodExceptionFilter', () => {
	const filter = new ZodExceptionFilter()

	it('returns 400 with field/message pairs for each issue', () => {
		const { host, status, send } = makeHost()
		const schema = z.object({
			email: z.email('invalid email'),
			age: z.number().min(18, 'too young'),
		})
		const result = schema.safeParse({ email: 'not-an-email', age: 10 })
		expect(result.success).toBe(false)

		filter.catch((result as { error: z.ZodError }).error, host)

		expect(status).toHaveBeenCalledWith(400)
		const body = send.mock.calls[0][0]
		expect(body.statusCode).toBe(400)
		expect(body.message).toBe('Validation failed')
		expect(body.errors).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ field: 'email' }),
				expect.objectContaining({ field: 'age', message: 'too young' }),
			]),
		)
	})

	it('joins nested field paths with dots', () => {
		const { host, send } = makeHost()
		const schema = z.object({
			user: z.object({
				profile: z.object({
					name: z.string().min(2, 'too short'),
				}),
			}),
		})
		const result = schema.safeParse({ user: { profile: { name: '' } } })

		filter.catch((result as { error: z.ZodError }).error, host)

		const body = send.mock.calls[0][0]
		expect(body.errors[0].field).toBe('user.profile.name')
	})

	it('handles empty path (root-level errors)', () => {
		const { host, send } = makeHost()
		// Force an error at the root of the parse (refine on the object itself)
		const schema = z.object({}).refine(() => false, { message: 'root failed' })
		const result = schema.safeParse({})

		filter.catch((result as { error: z.ZodError }).error, host)

		const body = send.mock.calls[0][0]
		expect(body.errors[0].field).toBe('')
		expect(body.errors[0].message).toBe('root failed')
	})
})
