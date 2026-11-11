import type { RedisService } from '@/shared/redis/redis.service'
import {
	ACCOUNT_SNAPSHOT_TTL_SECONDS,
	type AccountSnapshot,
	AccountSnapshotStore,
} from './account-snapshot.store'

const snapshot: AccountSnapshot = {
	email: 'seller@example.com',
	role: 'seller',
	plan_type: 'pro',
	is_active: true,
	session_version: 2,
}

describe('AccountSnapshotStore', () => {
	let redis: { setWithExpiry: jest.Mock; delete: jest.Mock }
	let store: AccountSnapshotStore

	beforeEach(() => {
		redis = { setWithExpiry: jest.fn(), delete: jest.fn() }
		store = new AccountSnapshotStore(redis as unknown as RedisService)
		jest.spyOn((store as any).logger, 'error').mockImplementation(() => undefined)
	})

	it('stores the snapshot under the account key with a 60-second TTL', async () => {
		await store.set('acc-1', snapshot)

		expect(ACCOUNT_SNAPSHOT_TTL_SECONDS).toBe(60)
		expect(redis.setWithExpiry).toHaveBeenCalledWith(
			'auth:account:acc-1',
			JSON.stringify(snapshot),
			60,
		)
	})

	it('round-trips a stored snapshot', () => {
		expect(store.parse(JSON.stringify(snapshot))).toEqual(snapshot)
	})

	it.each([
		['nothing cached', null],
		['invalid JSON', '{oops'],
		['a non-object', '"text"'],
		['a missing field', JSON.stringify({ ...snapshot, session_version: undefined })],
		['a wrongly typed field', JSON.stringify({ ...snapshot, is_active: 'true' })],
	])('treats %s as a cache miss', (_, raw) => {
		expect(store.parse(raw)).toBeNull()
	})

	it('invalidates by deleting the account key', async () => {
		await store.invalidate('acc-1')

		expect(redis.delete).toHaveBeenCalledWith('auth:account:acc-1')
	})

	it('does not throw when the invalidation cannot reach Redis (the write already happened)', async () => {
		redis.delete.mockRejectedValueOnce(new Error('ECONNREFUSED'))

		await expect(store.invalidate('acc-1')).resolves.toBeUndefined()
	})
})
