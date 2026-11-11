/**
 * RedisService lock unit tests (used by checkout to serialize per-account attempts).
 * Verifies: SET NX PX with a random token; null when held; compare-and-delete release
 *           that refuses a foreign token.
 */
import { ConfigService } from '@nestjs/config'
import { RedisService } from './redis.service'

const multiMock = {
	hset: jest.fn().mockReturnThis(),
	expire: jest.fn().mockReturnThis(),
	exec: jest.fn(),
}
const clientMock = {
	set: jest.fn(),
	get: jest.fn(),
	eval: jest.fn(),
	hgetall: jest.fn(),
	multi: jest.fn(() => multiMock),
	quit: jest.fn(),
}
jest.mock('ioredis', () => ({
	__esModule: true,
	default: jest.fn(() => clientMock),
}))

describe('RedisService locks', () => {
	let service: RedisService

	beforeEach(() => {
		jest.clearAllMocks()
		service = new RedisService({ get: jest.fn() } as unknown as ConfigService)
	})

	it('acquires with SET NX PX and returns a random token', async () => {
		clientMock.set.mockResolvedValue('OK')

		const first = await service.acquireLock('checkout-lock:acc-1', 15_000)
		const second = await service.acquireLock('checkout-lock:acc-1', 15_000)

		expect(clientMock.set).toHaveBeenCalledWith('checkout-lock:acc-1', first, 'PX', 15_000, 'NX')
		expect(first).toMatch(/^[0-9a-f-]{36}$/)
		expect(second).not.toBe(first)
	})

	it('returns null when someone else holds the lock', async () => {
		clientMock.set.mockResolvedValueOnce(null)

		await expect(service.acquireLock('checkout-lock:acc-1', 15_000)).resolves.toBeNull()
	})

	it('reports whether the lock is still held with this token', async () => {
		clientMock.get.mockResolvedValueOnce('mine').mockResolvedValueOnce('someone-else')

		await expect(service.isLockHeld('checkout-lock:acc-1', 'mine')).resolves.toBe(true)
		await expect(service.isLockHeld('checkout-lock:acc-1', 'mine')).resolves.toBe(false)
		expect(clientMock.get).toHaveBeenCalledWith('checkout-lock:acc-1')
	})

	it('releases only with the owning token (compare-and-delete)', async () => {
		clientMock.eval.mockResolvedValueOnce(1).mockResolvedValueOnce(0)

		await expect(service.releaseLock('checkout-lock:acc-1', 'mine')).resolves.toBe(true)
		await expect(service.releaseLock('checkout-lock:acc-1', 'not-mine')).resolves.toBe(false)

		const [script, numKeys, key, token] = clientMock.eval.mock.calls[0]
		expect(script).toContain('redis.call("get", KEYS[1]) == ARGV[1]')
		expect(numKeys).toBe(1)
		expect(key).toBe('checkout-lock:acc-1')
		expect(token).toBe('mine')
	})
})

describe('RedisService hashes and scripts (session store)', () => {
	let service: RedisService

	beforeEach(() => {
		jest.clearAllMocks()
		service = new RedisService({ get: jest.fn() } as unknown as ConfigService)
	})

	it('reads a hash, yielding an empty object for a missing key', async () => {
		clientMock.hgetall.mockResolvedValueOnce({ sub: 'acc-1' }).mockResolvedValueOnce({})

		await expect(service.getHash('auth:session:s1')).resolves.toEqual({ sub: 'acc-1' })
		await expect(service.getHash('auth:session:nope')).resolves.toEqual({})
	})

	it('writes hash fields and the TTL in one transaction', async () => {
		multiMock.exec.mockResolvedValueOnce([
			[null, 1],
			[null, 1],
		])

		await service.setHashWithExpiry('auth:session:s1', { rjti: 'r1' }, 3600)

		expect(multiMock.hset).toHaveBeenCalledWith('auth:session:s1', { rjti: 'r1' })
		expect(multiMock.expire).toHaveBeenCalledWith('auth:session:s1', 3600)
		expect(multiMock.exec).toHaveBeenCalledTimes(1)
	})

	it('throws when a command of the transaction fails (no hash left without a TTL unnoticed)', async () => {
		multiMock.exec.mockResolvedValueOnce([
			[null, 1],
			[new Error('ERR expire failed'), null],
		])

		await expect(
			service.setHashWithExpiry('auth:session:s1', { rjti: 'r1' }, 3600),
		).rejects.toThrow('ERR expire failed')
	})

	it('throws when the transaction is discarded', async () => {
		multiMock.exec.mockResolvedValueOnce(null)

		await expect(
			service.setHashWithExpiry('auth:session:s1', { rjti: 'r1' }, 3600),
		).rejects.toThrow('Redis transaction was discarded')
	})

	it('passes keys (prefixed by ioredis) and args to EVAL in order', async () => {
		clientMock.eval.mockResolvedValueOnce(['rotated', '60', '1'])

		await expect(service.evalScript('return 1', ['k1'], ['a', 'b'])).resolves.toEqual([
			'rotated',
			'60',
			'1',
		])
		expect(clientMock.eval).toHaveBeenCalledWith('return 1', 1, 'k1', 'a', 'b')
	})
})
