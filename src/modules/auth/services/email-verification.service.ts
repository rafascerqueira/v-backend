import { Injectable } from '@nestjs/common'
import { createHash, randomBytes } from 'crypto'
import { EmailService } from '@/shared/email/email.service'
import { PrismaService } from '@/shared/prisma/prisma.service'

@Injectable()
export class EmailVerificationService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly emailService: EmailService,
	) {}

	private generateToken(): string {
		return randomBytes(32).toString('hex')
	}

	private hashToken(token: string): string {
		return createHash('sha256').update(token).digest('hex')
	}

	async createVerificationToken(accountId: string, email: string, name: string): Promise<void> {
		await this.prisma.email_verification_token.deleteMany({
			where: { account_id: accountId },
		})

		const token = this.generateToken()
		const hashedToken = this.hashToken(token)
		const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours

		await this.prisma.email_verification_token.create({
			data: {
				account_id: accountId,
				token: hashedToken,
				expires_at: expiresAt,
			},
		})

		await this.emailService.sendEmailVerification(email, token, name)
	}

	async verifyEmail(token: string): Promise<{ success: boolean; message: string }> {
		const hashedToken = this.hashToken(token)

		const verificationToken = await this.prisma.email_verification_token.findFirst({
			where: {
				token: hashedToken,
				expires_at: { gt: new Date() },
				used_at: null,
			},
			include: { account: true },
		})

		if (!verificationToken) {
			return { success: false, message: 'Token inválido ou expirado' }
		}

		if (verificationToken.account.email_verified) {
			return { success: false, message: 'Email já foi verificado' }
		}

		await this.prisma.$transaction([
			this.prisma.account.update({
				where: { id: verificationToken.account_id },
				data: {
					email_verified: true,
					email_verified_at: new Date(),
				},
			}),
			this.prisma.email_verification_token.update({
				where: { id: verificationToken.id },
				data: { used_at: new Date() },
			}),
		])

		await this.emailService.sendWelcomeEmail(
			verificationToken.account.email,
			verificationToken.account.name,
		)

		return { success: true, message: 'Email verificado com sucesso!' }
	}

	async resendVerification(email: string): Promise<{ success: boolean; message: string }> {
		const account = await this.prisma.account.findUnique({
			where: { email },
		})

		if (!account) {
			return { success: true, message: 'Se o email estiver cadastrado, você receberá o link de verificação.' }
		}

		if (account.email_verified) {
			return { success: false, message: 'Email já foi verificado' }
		}

		await this.createVerificationToken(account.id, account.email, account.name)

		return { success: true, message: 'Se o email estiver cadastrado, você receberá o link de verificação.' }
	}
}
