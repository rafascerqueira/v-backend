import { ConflictException, UnprocessableEntityException } from '@nestjs/common'
import type { Prisma } from '@/generated/prisma/client'
import { claimIdempotencyKey, completeIdempotencyKey } from './idempotency'
import { parseIdempotencyKey } from './idempotency-key.decorator'
import { hashRequest } from './request-hash'

const identity = { sellerId: 's1', scope: 'orders.create', key: 'k1', requestHash: 'h1' }

const makeTx = () => {
	const tx = {
		$executeRaw: jest.fn(),
		idempotencyKey: { findUnique: jest.fn(), update: jest.fn() },
	}
	return { tx, client: tx as unknown as Prisma.TransactionClient }
}

describe('claimIdempotencyKey', () => {
	it('claims a fresh key (row inserted with an empty resource)', async () => {
		const { tx, client } = makeTx()
		tx.$executeRaw.mockResolvedValueOnce(1)

		await expect(claimIdempotencyKey(client, identity, 'order')).resolves.toEqual({ claimed: true })
		expect(tx.idempotencyKey.findUnique).not.toHaveBeenCalled()
	})

	it('replays a used key whose body matches', async () => {
		const { tx, client } = makeTx()
		tx.$executeRaw.mockResolvedValueOnce(0)
		tx.idempotencyKey.findUnique.mockResolvedValueOnce({
			request_hash: 'h1',
			resource_id: '42',
			status_code: 201,
		})

		await expect(claimIdempotencyKey(client, identity, 'order')).resolves.toEqual({
			claimed: false,
			resourceId: '42',
			statusCode: 201,
		})
		expect(tx.idempotencyKey.findUnique).toHaveBeenCalledWith({
			where: { seller_id_scope_key: { seller_id: 's1', scope: 'orders.create', key: 'k1' } },
		})
	})

	it('answers 422 IDEMPOTENCY_KEY_MISMATCH when the body differs', async () => {
		const { tx, client } = makeTx()
		tx.$executeRaw.mockResolvedValueOnce(0)
		tx.idempotencyKey.findUnique.mockResolvedValueOnce({
			request_hash: 'other',
			resource_id: '42',
			status_code: 201,
		})

		const error = await claimIdempotencyKey(client, identity, 'order').catch((e) => e)

		expect(error).toBeInstanceOf(UnprocessableEntityException)
		expect(error.getResponse()).toMatchObject({ code: 'IDEMPOTENCY_KEY_MISMATCH' })
	})

	it.each([
		['the row was purged in between', null],
		['the first request has not finished', { request_hash: 'h1', resource_id: '', status_code: 0 }],
	])('answers a retryable 409 when %s', async (_case, row) => {
		const { tx, client } = makeTx()
		tx.$executeRaw.mockResolvedValueOnce(0)
		tx.idempotencyKey.findUnique.mockResolvedValueOnce(row)

		const error = await claimIdempotencyKey(client, identity, 'order').catch((e) => e)

		expect(error).toBeInstanceOf(ConflictException)
		expect(error.getResponse()).toMatchObject({ code: 'IDEMPOTENCY_KEY_IN_PROGRESS' })
	})

	it('completes the key with the created resource', async () => {
		const { tx, client } = makeTx()

		await completeIdempotencyKey(client, identity, 42, 201)

		expect(tx.idempotencyKey.update).toHaveBeenCalledWith({
			where: { seller_id_scope_key: { seller_id: 's1', scope: 'orders.create', key: 'k1' } },
			data: { resource_id: '42', status_code: 201 },
		})
	})
})

describe('hashRequest', () => {
	it('ignores key order and undefined members', () => {
		expect(hashRequest({ a: 1, b: { c: 2, d: [1, 2] }, e: undefined })).toBe(
			hashRequest({ b: { d: [1, 2], c: 2 }, a: 1 }),
		)
	})

	it('hashes dates as their JSON rendering (not as an empty object)', () => {
		expect(hashRequest({ at: new Date('2026-11-02T12:00:00Z') })).toBe(
			hashRequest({ at: '2026-11-02T12:00:00.000Z' }),
		)
		expect(hashRequest({ at: new Date('2026-11-02T12:00:00Z') })).not.toBe(
			hashRequest({ at: new Date('2026-11-03T12:00:00Z') }),
		)
	})

	it('changes with any value, array order included', () => {
		const base = hashRequest({ items: [{ id: 1 }, { id: 2 }] })
		expect(hashRequest({ items: [{ id: 2 }, { id: 1 }] })).not.toBe(base)
		expect(hashRequest({ items: [{ id: 1 }, { id: 3 }] })).not.toBe(base)
	})

	it('is a hex SHA-256', () => {
		expect(hashRequest({})).toMatch(/^[0-9a-f]{64}$/)
	})
})

describe('parseIdempotencyKey', () => {
	it.each([undefined, ''])('treats %p as no key', (raw) => {
		expect(parseIdempotencyKey(raw)).toBeUndefined()
	})

	it('accepts a UUID and the first of repeated headers', () => {
		const uuid = '3b241101-e2bb-4255-8caf-4136c566a962'
		expect(parseIdempotencyKey(uuid)).toBe(uuid)
		expect(parseIdempotencyKey([uuid, 'other'])).toBe(uuid)
	})

	it.each([
		'short-key-15chr',
		'has space in the key',
		'a'.repeat(65),
		'semi;colon;key;123',
		'ação-é-inválida-aqui',
	])('rejects %p with 400', (raw) => {
		expect(() => parseIdempotencyKey(raw)).toThrow(/Idempotency-Key inválido/)
	})
})
