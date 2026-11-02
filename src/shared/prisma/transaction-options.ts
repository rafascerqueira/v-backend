/**
 * Options for transactions that take row locks on hot rows (a product's stock, a
 * seller's order counter). Requests for the same product queue on that lock, so
 * Prisma's defaults (2 s to get a connection, 5 s total) make the tail of a burst
 * fail with "transaction expired" even though every request would succeed.
 */
export const LOCKING_TRANSACTION = { maxWait: 10_000, timeout: 20_000 } as const
