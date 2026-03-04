import { createHash, randomBytes } from 'node:crypto'
import { Inject, Injectable } from '@nestjs/common'
import { EmailService } from '@/shared/email/email.service'
import {
	EMAIL_VERIFICATION_REPOSITORY,
	type EmailVerificationRepository,
} from '@/shared/repositories/email-verification.repository'

@Injectable()
export class EmailVerificationService {
	constructor(
		@Inject(EMAIL_VERIFICATION_REPOSITORY)
		private readonly emailVerificationRepository: EmailVerificationRepository,
		private readonly emailService: EmailService,
	) {}

	private generateToken(): string {
		return randomBytes(32).toString('hex')
	}

	private hashToken(token: string): string {
		return createHash('sha256').update(token).digest('hex')
	}

	async createVerificationToken(accountId: string, email: string, name: string): Promise<void> {
		await this.emailVerificationRepository.deleteTokensByAccountId(accountId)

		const token = this.generateToken()
		const hashedToken = this.hashToken(token)
		const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours

		await this.emailVerificationRepository.createToken({
			account_id: accountId,
			token: hashedToken,
			expires_at: expiresAt,
		})

		await this.emailService.sendEmailVerification(email, token, name)
	}

	async verifyEmail(token: string): Promise<{ success: boolean; message: string }> {
		const hashedToken = this.hashToken(token)

		const verificationToken = await this.emailVerificationRepository.findValidToken(hashedToken)

		if (!verificationToken) {
			return { success: false, message: 'Token inválido ou expirado' }
		}

		if (verificationToken.account.email_verified) {
			return { success: false, message: 'Email já foi verificado' }
		}

		await this.emailVerificationRepository.verifyEmailTransaction(
			verificationToken.account_id,
			verificationToken.id,
		)

		await this.emailService.sendWelcomeEmail(
			verificationToken.account.email,
			verificationToken.account.name,
		)

		return { success: true, message: 'Email verificado com sucesso!' }
	}

	async resendVerification(email: string): Promise<{ success: boolean; message: string }> {
		const account = await this.emailVerificationRepository.findAccountByEmail(email)

		if (!account) {
			return {
				success: true,
				message: 'Se o email estiver cadastrado, você receberá o link de verificação.',
			}
		}

		if (account.email_verified) {
			return { success: false, message: 'Email já foi verificado' }
		}

		await this.createVerificationToken(account.id, account.email, account.name)

		return {
			success: true,
			message: 'Se o email estiver cadastrado, você receberá o link de verificação.',
		}
	}
}
