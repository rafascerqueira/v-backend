import { createHash, randomBytes } from 'node:crypto'
import { Inject, Injectable } from '@nestjs/common'
import { AccountService } from '@/modules/users/services/account.service'
import { PasswordHasherService } from '@/shared/crypto/password-hasher.service'
import { QueueProducer } from '@/shared/queue/queue.producer'
import {
	PASSWORD_RESET_REPOSITORY,
	type PasswordResetRepository,
} from '@/shared/repositories/password-reset.repository'

@Injectable()
export class PasswordResetService {
	constructor(
		@Inject(PASSWORD_RESET_REPOSITORY)
		private readonly passwordResetRepository: PasswordResetRepository,
		private readonly accountService: AccountService,
		private readonly queueProducer: QueueProducer,
		private readonly passwordHasher: PasswordHasherService,
	) {}

	private generateToken(): string {
		return randomBytes(32).toString('hex')
	}

	private hashToken(token: string): string {
		return createHash('sha256').update(token).digest('hex')
	}

	async createResetToken(email: string): Promise<{ success: boolean; token?: string }> {
		const account = await this.accountService.findByEmail(email)

		if (!account) {
			return { success: true }
		}

		await this.passwordResetRepository.deleteTokensByAccountId(account.id)

		const token = this.generateToken()
		const hashedToken = this.hashToken(token)
		const expiresAt = new Date(Date.now() + 60 * 60 * 1000)

		await this.passwordResetRepository.createToken({
			account_id: account.id,
			token: hashedToken,
			expires_at: expiresAt,
		})

		await this.queueProducer.sendPasswordResetEmail({ to: email, name: account.name, token })

		return { success: true }
	}

	async resetPassword(token: string, newPassword: string): Promise<boolean> {
		const hashedToken = this.hashToken(token)

		const resetToken = await this.passwordResetRepository.findValidToken(hashedToken)

		if (!resetToken) {
			return false
		}

		const { hash, salt } = await this.passwordHasher.hash(newPassword)

		await this.passwordResetRepository.resetPasswordTransaction(
			resetToken.account_id,
			resetToken.id,
			hash,
			salt,
		)

		return true
	}
}
