/**
 * EmailVerificationService unit tests
 * Covers: createVerificationToken, verifyEmail, resendVerification
 * Verifies: token hashing, QueueProducer usage, already-verified guard, not-found guard
 */
import { Test } from '@nestjs/testing'
import { QueueProducer } from '@/shared/queue/queue.producer'
import {
	EMAIL_VERIFICATION_REPOSITORY,
	type EmailVerificationRepository,
} from '@/shared/repositories/email-verification.repository'
import { EmailVerificationService } from './email-verification.service'

const repositoryMock: jest.Mocked<EmailVerificationRepository> = {
	deleteTokensByAccountId: jest.fn(),
	createToken: jest.fn(),
	findValidToken: jest.fn(),
	verifyEmailTransaction: jest.fn(),
	findAccountByEmail: jest.fn(),
}

const queueProducerMock = {
	sendEmailVerification: jest.fn(),
	sendWelcomeEmail: jest.fn(),
}

describe('EmailVerificationService', () => {
	let service: EmailVerificationService

	beforeEach(async () => {
		const module = await Test.createTestingModule({
			providers: [
				EmailVerificationService,
				{ provide: EMAIL_VERIFICATION_REPOSITORY, useValue: repositoryMock },
				{ provide: QueueProducer, useValue: queueProducerMock },
			],
		}).compile()

		service = module.get(EmailVerificationService)
		jest.clearAllMocks()
	})

	describe('createVerificationToken', () => {
		it('should delete old tokens, create a new hashed token, and enqueue verification email', async () => {
			repositoryMock.deleteTokensByAccountId.mockResolvedValueOnce(undefined)
			repositoryMock.createToken.mockResolvedValueOnce(undefined)
			queueProducerMock.sendEmailVerification.mockResolvedValueOnce(undefined)

			await service.createVerificationToken('acc-1', 'user@test.com', 'Alice')

			expect(repositoryMock.deleteTokensByAccountId).toHaveBeenCalledWith('acc-1')
			expect(repositoryMock.createToken).toHaveBeenCalledWith(
				expect.objectContaining({
					account_id: 'acc-1',
					token: expect.any(String),
					expires_at: expect.any(Date),
				}),
			)
			// Token stored must be SHA-256 hash (64 hex chars), never the raw token
			const storedToken: string = repositoryMock.createToken.mock.calls[0][0].token
			expect(storedToken).toHaveLength(64)
			expect(queueProducerMock.sendEmailVerification).toHaveBeenCalledWith(
				expect.objectContaining({ to: 'user@test.com', name: 'Alice', token: expect.any(String) }),
			)
			// Raw token passed to queue must differ from hashed token stored in DB
			const queueToken: string = queueProducerMock.sendEmailVerification.mock.calls[0][0].token
			expect(queueToken).not.toBe(storedToken)
		})

		it('should set expiry ~24 hours in the future', async () => {
			repositoryMock.deleteTokensByAccountId.mockResolvedValueOnce(undefined)
			repositoryMock.createToken.mockResolvedValueOnce(undefined)
			queueProducerMock.sendEmailVerification.mockResolvedValueOnce(undefined)

			const before = Date.now()
			await service.createVerificationToken('acc-1', 'user@test.com', 'Alice')
			const after = Date.now()

			const storedExpiry: Date = repositoryMock.createToken.mock.calls[0][0].expires_at
			const expiryMs = storedExpiry.getTime()
			expect(expiryMs).toBeGreaterThan(before + 23 * 60 * 60 * 1000)
			expect(expiryMs).toBeLessThan(after + 25 * 60 * 60 * 1000)
		})
	})

	describe('verifyEmail', () => {
		it('should return success and enqueue welcome email when token is valid and not yet verified', async () => {
			repositoryMock.findValidToken.mockResolvedValueOnce({
				id: 1,
				account_id: 'acc-1',
				account: { email: 'user@test.com', name: 'Alice', email_verified: false },
			} as any)
			repositoryMock.verifyEmailTransaction.mockResolvedValueOnce(undefined)
			queueProducerMock.sendWelcomeEmail.mockResolvedValueOnce(undefined)

			const result = await service.verifyEmail('raw-token')

			expect(result.success).toBe(true)
			expect(repositoryMock.verifyEmailTransaction).toHaveBeenCalledWith('acc-1', 1)
			expect(queueProducerMock.sendWelcomeEmail).toHaveBeenCalledWith(
				expect.objectContaining({ to: 'user@test.com', name: 'Alice' }),
			)
		})

		it('should return failure when token is invalid or expired', async () => {
			repositoryMock.findValidToken.mockResolvedValueOnce(null)

			const result = await service.verifyEmail('invalid-token')

			expect(result.success).toBe(false)
			expect(result.message).toBeTruthy()
			expect(repositoryMock.verifyEmailTransaction).not.toHaveBeenCalled()
		})

		it('should return failure when email is already verified', async () => {
			repositoryMock.findValidToken.mockResolvedValueOnce({
				id: 2,
				account_id: 'acc-2',
				account: { email: 'user@test.com', name: 'Bob', email_verified: true },
			} as any)

			const result = await service.verifyEmail('some-token')

			expect(result.success).toBe(false)
			expect(repositoryMock.verifyEmailTransaction).not.toHaveBeenCalled()
			expect(queueProducerMock.sendWelcomeEmail).not.toHaveBeenCalled()
		})
	})

	describe('resendVerification', () => {
		it('should return generic success when account does not exist (privacy guard)', async () => {
			repositoryMock.findAccountByEmail.mockResolvedValueOnce(null)

			const result = await service.resendVerification('unknown@test.com')

			expect(result.success).toBe(true)
			expect(repositoryMock.deleteTokensByAccountId).not.toHaveBeenCalled()
		})

		it('should return generic success when email is already verified', async () => {
			repositoryMock.findAccountByEmail.mockResolvedValueOnce({
				id: 'acc-1',
				email: 'user@test.com',
				name: 'Alice',
				email_verified: true,
			})

			const result = await service.resendVerification('user@test.com')

			expect(result.success).toBe(true)
			expect(repositoryMock.deleteTokensByAccountId).not.toHaveBeenCalled()
		})

		it('should create a new token and return success when account exists and is not verified', async () => {
			repositoryMock.findAccountByEmail.mockResolvedValueOnce({
				id: 'acc-1',
				email: 'user@test.com',
				name: 'Alice',
				email_verified: false,
			})
			repositoryMock.deleteTokensByAccountId.mockResolvedValueOnce(undefined)
			repositoryMock.createToken.mockResolvedValueOnce(undefined)
			queueProducerMock.sendEmailVerification.mockResolvedValueOnce(undefined)

			const result = await service.resendVerification('user@test.com')

			expect(result.success).toBe(true)
			expect(repositoryMock.deleteTokensByAccountId).toHaveBeenCalledWith('acc-1')
			expect(queueProducerMock.sendEmailVerification).toHaveBeenCalled()
		})
	})
})
