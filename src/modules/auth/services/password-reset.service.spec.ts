/**
 * PasswordResetService unit tests
 * Covers: createResetToken, resetPassword
 * Verifies: token hashing, QueueProducer enqueue, not-found guard, cooldown guard, password hashing delegation
 */
import { Test } from '@nestjs/testing'
import { AccountService } from '@/modules/users/services/account.service'
import { PasswordHasherService } from '@/shared/crypto/password-hasher.service'
import { QueueProducer } from '@/shared/queue/queue.producer'
import { RedisService } from '@/shared/redis/redis.service'
import {
	PASSWORD_RESET_REPOSITORY,
	type PasswordResetRepository,
} from '@/shared/repositories/password-reset.repository'
import { PasswordResetService } from './password-reset.service'

const repositoryMock: jest.Mocked<PasswordResetRepository> = {
	deleteTokensByAccountId: jest.fn(),
	createToken: jest.fn(),
	findValidToken: jest.fn(),
	resetPasswordTransaction: jest.fn(),
}

const accountServiceMock = {
	findByEmail: jest.fn(),
}

const passwordHasherMock = {
	hash: jest.fn(),
}

const queueProducerMock = {
	sendPasswordResetEmail: jest.fn(),
}

const redisMock = {
	exists: jest.fn(),
	setWithExpiry: jest.fn(),
}

describe('PasswordResetService', () => {
	let service: PasswordResetService

	beforeEach(async () => {
		const module = await Test.createTestingModule({
			providers: [
				PasswordResetService,
				{ provide: PASSWORD_RESET_REPOSITORY, useValue: repositoryMock },
				{ provide: AccountService, useValue: accountServiceMock },
				{ provide: PasswordHasherService, useValue: passwordHasherMock },
				{ provide: QueueProducer, useValue: queueProducerMock },
				{ provide: RedisService, useValue: redisMock },
			],
		}).compile()

		service = module.get(PasswordResetService)
		jest.clearAllMocks()
	})

	describe('createResetToken', () => {
		it('should return success silently when account does not exist (privacy guard)', async () => {
			redisMock.exists.mockResolvedValueOnce(false)
			accountServiceMock.findByEmail.mockResolvedValueOnce(null)

			const result = await service.createResetToken('unknown@test.com')

			expect(result.success).toBe(true)
			expect(repositoryMock.deleteTokensByAccountId).not.toHaveBeenCalled()
			expect(queueProducerMock.sendPasswordResetEmail).not.toHaveBeenCalled()
		})

		it('should return success silently and skip email when cooldown is active', async () => {
			redisMock.exists.mockResolvedValueOnce(true)

			const result = await service.createResetToken('alice@test.com')

			expect(result.success).toBe(true)
			expect(accountServiceMock.findByEmail).not.toHaveBeenCalled()
			expect(repositoryMock.deleteTokensByAccountId).not.toHaveBeenCalled()
			expect(queueProducerMock.sendPasswordResetEmail).not.toHaveBeenCalled()
		})

		it('should delete old tokens, create hashed token, and enqueue reset email', async () => {
			redisMock.exists.mockResolvedValueOnce(false)
			redisMock.setWithExpiry.mockResolvedValueOnce(undefined)
			accountServiceMock.findByEmail.mockResolvedValueOnce({
				id: 'acc-1',
				name: 'Alice',
				email: 'alice@test.com',
			})
			repositoryMock.deleteTokensByAccountId.mockResolvedValueOnce(undefined)
			repositoryMock.createToken.mockResolvedValueOnce(undefined)
			queueProducerMock.sendPasswordResetEmail.mockResolvedValueOnce(undefined)

			const result = await service.createResetToken('alice@test.com')

			expect(result.success).toBe(true)
			expect(repositoryMock.deleteTokensByAccountId).toHaveBeenCalledWith('acc-1')
			expect(repositoryMock.createToken).toHaveBeenCalledWith(
				expect.objectContaining({
					account_id: 'acc-1',
					token: expect.any(String),
					expires_at: expect.any(Date),
				}),
			)
			// Token stored must be hashed (64 hex chars)
			const storedToken: string = repositoryMock.createToken.mock.calls[0][0].token
			expect(storedToken).toHaveLength(64)
			expect(queueProducerMock.sendPasswordResetEmail).toHaveBeenCalledWith(
				expect.objectContaining({ to: 'alice@test.com', name: 'Alice', token: expect.any(String) }),
			)
			// Raw token passed to queue must differ from stored hash
			const queueToken: string = queueProducerMock.sendPasswordResetEmail.mock.calls[0][0].token
			expect(queueToken).not.toBe(storedToken)
		})

		it('should set cooldown in Redis after successfully enqueuing the email', async () => {
			redisMock.exists.mockResolvedValueOnce(false)
			redisMock.setWithExpiry.mockResolvedValueOnce(undefined)
			accountServiceMock.findByEmail.mockResolvedValueOnce({
				id: 'acc-1',
				name: 'Alice',
				email: 'alice@test.com',
			})
			repositoryMock.deleteTokensByAccountId.mockResolvedValueOnce(undefined)
			repositoryMock.createToken.mockResolvedValueOnce(undefined)
			queueProducerMock.sendPasswordResetEmail.mockResolvedValueOnce(undefined)

			await service.createResetToken('alice@test.com')

			expect(redisMock.setWithExpiry).toHaveBeenCalledWith(
				expect.stringContaining('pwdreset:cd:'),
				'1',
				120,
			)
		})

		it('should set expiry ~1 hour in the future', async () => {
			redisMock.exists.mockResolvedValueOnce(false)
			redisMock.setWithExpiry.mockResolvedValueOnce(undefined)
			accountServiceMock.findByEmail.mockResolvedValueOnce({
				id: 'acc-1',
				name: 'Alice',
				email: 'alice@test.com',
			})
			repositoryMock.deleteTokensByAccountId.mockResolvedValueOnce(undefined)
			repositoryMock.createToken.mockResolvedValueOnce(undefined)
			queueProducerMock.sendPasswordResetEmail.mockResolvedValueOnce(undefined)

			const before = Date.now()
			await service.createResetToken('alice@test.com')
			const after = Date.now()

			const storedExpiry: Date = repositoryMock.createToken.mock.calls[0][0].expires_at
			expect(storedExpiry.getTime()).toBeGreaterThan(before + 59 * 60 * 1000)
			expect(storedExpiry.getTime()).toBeLessThan(after + 61 * 60 * 1000)
		})
	})

	describe('resetPassword', () => {
		it('should return false when token is invalid or expired', async () => {
			repositoryMock.findValidToken.mockResolvedValueOnce(null)

			const result = await service.resetPassword('invalid-token', 'newpass')

			expect(result).toBe(false)
			expect(repositoryMock.resetPasswordTransaction).not.toHaveBeenCalled()
		})

		it('should hash new password and call resetPasswordTransaction when token is valid', async () => {
			repositoryMock.findValidToken.mockResolvedValueOnce({
				id: 10,
				account_id: 'acc-1',
			} as any)
			passwordHasherMock.hash.mockResolvedValueOnce({ hash: 'hashed-pw', salt: 'salt-value' })
			repositoryMock.resetPasswordTransaction.mockResolvedValueOnce(undefined)

			const result = await service.resetPassword('valid-token', 'NewPass123!')

			expect(result).toBe(true)
			expect(passwordHasherMock.hash).toHaveBeenCalledWith('NewPass123!')
			expect(repositoryMock.resetPasswordTransaction).toHaveBeenCalledWith(
				'acc-1',
				10,
				'hashed-pw',
				'salt-value',
			)
		})
	})
})
