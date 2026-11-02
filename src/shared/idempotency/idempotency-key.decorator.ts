import { BadRequestException, createParamDecorator, type ExecutionContext } from '@nestjs/common'

export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key'
const KEY_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

/** Validates the optional Idempotency-Key header value. Absent/empty → undefined. */
export function parseIdempotencyKey(raw: string | string[] | undefined): string | undefined {
	const value = Array.isArray(raw) ? raw[0] : raw
	if (value === undefined || value === '') return undefined
	if (!KEY_PATTERN.test(value)) {
		throw new BadRequestException(
			'Cabeçalho Idempotency-Key inválido: use até 64 caracteres entre letras, números, "-" e "_".',
		)
	}
	return value
}

/**
 * The request's `Idempotency-Key` header (optional). Endpoints that accept it replay
 * the original response for a repeated key + body, and answer 422
 * IDEMPOTENCY_KEY_MISMATCH when the key is reused with a different body.
 */
export const IdempotencyKey = createParamDecorator(
	(_data: unknown, ctx: ExecutionContext): string | undefined => {
		const request = ctx.switchToHttp().getRequest<{ headers: Record<string, string | string[]> }>()
		return parseIdempotencyKey(request.headers[IDEMPOTENCY_KEY_HEADER])
	},
)
