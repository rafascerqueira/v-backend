import { ConflictException, UnprocessableEntityException } from '@nestjs/common'
import type { Prisma } from '@/generated/prisma/client'

export const IDEMPOTENCY_ERROR_CODES = {
	mismatch: 'IDEMPOTENCY_KEY_MISMATCH',
	inProgress: 'IDEMPOTENCY_KEY_IN_PROGRESS',
} as const

/** What a write endpoint passes down to make its repository call idempotent. */
export interface IdempotencyRequest {
	scope: string
	key: string
	requestHash: string
}

interface KeyIdentity extends IdempotencyRequest {
	sellerId: string
}

export type IdempotencyClaim =
	| { claimed: true }
	| { claimed: false; resourceId: string; statusCode: number }

/**
 * Claims an Idempotency-Key inside the caller's transaction, BEFORE the resource is
 * written. Call it only from a repository.
 *
 * - First use: the row is inserted (resource still empty) and `{ claimed: true }`
 *   comes back; finish with `completeIdempotencyKey` in the same transaction.
 * - Concurrent use: the INSERT waits on the first transaction's uncommitted row,
 *   then sees it once committed, so only one request ever creates the resource.
 * - Repeat with the same body: `{ claimed: false, resourceId }` so the caller can
 *   return the original resource.
 * - Same key, different body: 422 IDEMPOTENCY_KEY_MISMATCH.
 */
export async function claimIdempotencyKey(
	tx: Prisma.TransactionClient,
	identity: KeyIdentity,
	resourceType: string,
): Promise<IdempotencyClaim> {
	const { sellerId, scope, key, requestHash } = identity
	const inserted = await tx.$executeRaw`
		INSERT INTO idempotency_keys
			(seller_id, scope, key, request_hash, resource_type, resource_id, status_code)
		VALUES (${sellerId}, ${scope}, ${key}, ${requestHash}, ${resourceType}, '', 0)
		ON CONFLICT (seller_id, scope, key) DO NOTHING`
	if (inserted === 1) return { claimed: true }

	const existing = await tx.idempotencyKey.findUnique({
		where: { seller_id_scope_key: { seller_id: sellerId, scope, key } },
	})
	if (!existing) {
		// Purged between the INSERT and this read (7-day TTL boundary): retryable.
		throw inProgress()
	}
	if (existing.request_hash !== requestHash) {
		throw new UnprocessableEntityException({
			message:
				'Esta chave de idempotência já foi usada com outros dados. Gere uma nova chave para um novo envio.',
			error: 'Unprocessable Entity',
			code: IDEMPOTENCY_ERROR_CODES.mismatch,
		})
	}
	if (existing.resource_id === '') throw inProgress()
	return { claimed: false, resourceId: existing.resource_id, statusCode: existing.status_code }
}

export async function completeIdempotencyKey(
	tx: Prisma.TransactionClient,
	identity: KeyIdentity,
	resourceId: string | number,
	statusCode: number,
): Promise<void> {
	await tx.idempotencyKey.update({
		where: {
			seller_id_scope_key: {
				seller_id: identity.sellerId,
				scope: identity.scope,
				key: identity.key,
			},
		},
		data: { resource_id: String(resourceId), status_code: statusCode },
	})
}

function inProgress(): ConflictException {
	return new ConflictException({
		message: 'Este envio ainda está sendo processado. Tente novamente em instantes.',
		error: 'Conflict',
		code: IDEMPOTENCY_ERROR_CODES.inProgress,
	})
}
