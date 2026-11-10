import type { Prisma } from '@/generated/prisma/client'

export type SellerSequenceName = 'order'

/**
 * Next value of a per-seller counter. Call it only from a repository, inside the
 * transaction that uses the number: the upsert takes a row lock held until commit,
 * so concurrent transactions get distinct, contiguous values, and a rollback gives
 * the value back (no gaps from failed writes).
 */
export async function nextSellerSequenceValue(
	tx: Prisma.TransactionClient,
	sellerId: string,
	name: SellerSequenceName,
): Promise<number> {
	const [row] = await tx.$queryRaw<{ value: number }[]>`
		INSERT INTO seller_sequences (seller_id, name, value)
		VALUES (${sellerId}, ${name}, 1)
		ON CONFLICT (seller_id, name) DO UPDATE SET value = seller_sequences.value + 1
		RETURNING value`
	return Number(row.value)
}
