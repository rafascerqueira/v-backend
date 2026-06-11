/**
 * TokenBlacklistService unit tests
 * Covers: addToBlacklist, isBlacklisted
 * Verifies: Redis key prefix, SHA-256 hashing, TTL delegation
 */
import { Test } from '@nestjs/testing'
import { RedisService } from '@/shared/redis/redis.service'
import { TokenBlacklistService } from './token-blacklist.service'

const redisMock = {
	setWithExpiry: jest.fn(),
	exists: jest.fn(),
}

describe('TokenBlacklistService', () => {
	let service: TokenBlacklistService

	beforeEach(async () => {
		const module = await Test.createTestingModule({
			providers: [TokenBlacklistService, { provide: RedisService, useValue: redisMock }],
		}).compile()

		service = module.get(TokenBlacklistService)
		jest.clearAllMocks()
	})

	describe('addToBlacklist', () => {
		it('should store hashed token with the correct prefix and TTL', async () => {
			redisMock.setWithExpiry.mockResolvedValueOnce(undefined)

			await service.addToBlacklist('my-jwt-token', 3600)

			expect(redisMock.setWithExpiry).toHaveBeenCalledTimes(1)
			const [key, value, ttl] = redisMock.setWithExpiry.mock.calls[0]
			expect(key).toMatch(/^token:blacklist:[a-f0-9]{64}$/)
			expect(value).toBe('1')
			expect(ttl).toBe(3600)
		})

		it('should hash the same token consistently (deterministic)', async () => {
			redisMock.setWithExpiry.mockResolvedValue(undefined)

			await service.addToBlacklist('consistent-token', 60)
			await service.addToBlacklist('consistent-token', 60)

			const key1 = redisMock.setWithExpiry.mock.calls[0][0]
			const key2 = redisMock.setWithExpiry.mock.calls[1][0]
			expect(key1).toBe(key2)
		})

		it('should produce different keys for different tokens', async () => {
			redisMock.setWithExpiry.mockResolvedValue(undefined)

			await service.addToBlacklist('token-a', 60)
			await service.addToBlacklist('token-b', 60)

			const key1 = redisMock.setWithExpiry.mock.calls[0][0]
			const key2 = redisMock.setWithExpiry.mock.calls[1][0]
			expect(key1).not.toBe(key2)
		})
	})

	describe('isBlacklisted', () => {
		it('should return true when token key exists in Redis', async () => {
			redisMock.exists.mockResolvedValueOnce(true)

			const result = await service.isBlacklisted('blacklisted-token')

			expect(result).toBe(true)
			expect(redisMock.exists).toHaveBeenCalledTimes(1)
			const [key] = redisMock.exists.mock.calls[0]
			expect(key).toMatch(/^token:blacklist:[a-f0-9]{64}$/)
		})

		it('should return false when token key does not exist in Redis', async () => {
			redisMock.exists.mockResolvedValueOnce(false)

			const result = await service.isBlacklisted('valid-token')

			expect(result).toBe(false)
		})

		it('should use the same key for the same token as addToBlacklist', async () => {
			redisMock.setWithExpiry.mockResolvedValueOnce(undefined)
			redisMock.exists.mockResolvedValueOnce(true)

			await service.addToBlacklist('same-token', 100)
			await service.isBlacklisted('same-token')

			const addKey = redisMock.setWithExpiry.mock.calls[0][0]
			const checkKey = redisMock.exists.mock.calls[0][0]
			expect(addKey).toBe(checkKey)
		})
	})
})
