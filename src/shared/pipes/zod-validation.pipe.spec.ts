/**
 * ZodValidationPipe unit tests.
 * Covers: valid input passes through (transformed/coerced), invalid input throws
 *         a BadRequestException (HTTP 400) with the { message, errors } shape this
 *         pipe constructs.
 *
 * NOTE: this pipe catches the ZodError itself and rethrows a BadRequestException,
 * so the global ZodExceptionFilter never sees the ZodError for pipe-validated
 * bodies. See the bottom of this file for a documented finding about the
 * `errors` field being undefined under Zod 4.
 */
import { BadRequestException } from '@nestjs/common'
import { z } from 'zod'
import { ZodValidationPipe } from './zod-validation.pipe'

describe('ZodValidationPipe', () => {
	describe('valid input', () => {
		it('returns the parsed value unchanged for a matching object', () => {
			const schema = z.object({ name: z.string(), age: z.number() })
			const pipe = new ZodValidationPipe(schema)
			const input = { name: 'Ada', age: 30 }

			expect(pipe.transform(input)).toEqual(input)
		})

		it('returns the transformed value (coercion/defaults applied by the schema)', () => {
			const schema = z.object({
				page: z.coerce.number(),
				active: z.boolean().default(true),
			})
			const pipe = new ZodValidationPipe(schema)

			// page arrives as a string and is coerced to a number; active is defaulted.
			expect(pipe.transform({ page: '2' })).toEqual({ page: 2, active: true })
		})

		it('strips unknown keys for a plain object schema', () => {
			const schema = z.object({ keep: z.string() })
			const pipe = new ZodValidationPipe(schema)

			expect(pipe.transform({ keep: 'yes', drop: 'no' })).toEqual({ keep: 'yes' })
		})
	})

	describe('invalid input', () => {
		it('throws BadRequestException (HTTP 400) for a wrong field type', () => {
			const schema = z.object({ name: z.string() })
			const pipe = new ZodValidationPipe(schema)

			expect(() => pipe.transform({ name: 123 })).toThrow(BadRequestException)
		})

		it('maps to HTTP 400 with message "Validation failed"', () => {
			const schema = z.object({ email: z.string().email() })
			const pipe = new ZodValidationPipe(schema)

			try {
				pipe.transform({ email: 'not-an-email' })
				throw new Error('expected pipe to throw')
			} catch (err) {
				expect(err).toBeInstanceOf(BadRequestException)
				const e = err as BadRequestException
				expect(e.getStatus()).toBe(400)
				const response = e.getResponse() as { message: string; errors: unknown }
				expect(response.message).toBe('Validation failed')
			}
		})

		it('throws for a missing required field', () => {
			const schema = z.object({ required: z.string() })
			const pipe = new ZodValidationPipe(schema)

			expect(() => pipe.transform({})).toThrow(BadRequestException)
		})

		it('throws when the top-level value is the wrong primitive type', () => {
			const schema = z.string()
			const pipe = new ZodValidationPipe(schema)

			expect(() => pipe.transform(42)).toThrow(BadRequestException)
		})

		// FINDING (documented, not a wished-for assertion):
		// This pipe reads `error.errors`, but Zod 4 exposes issues on `error.issues`
		// (`error.errors` is undefined). So the per-field detail is lost: the response
		// body's `errors` key is literally undefined. We assert the ACTUAL behavior so
		// this is locked in / visible, and flag it for a human to fix in source.
		it('currently drops field-level detail because Zod 4 uses .issues not .errors (errors === undefined)', () => {
			const schema = z.object({ name: z.string() })
			const pipe = new ZodValidationPipe(schema)

			try {
				pipe.transform({ name: 123 })
				throw new Error('expected pipe to throw')
			} catch (err) {
				const response = (err as BadRequestException).getResponse() as {
					message: string
					errors: unknown
				}
				expect(response.errors).toBeUndefined()
			}
		})
	})
})
