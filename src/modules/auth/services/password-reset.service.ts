import { Injectable } from '@nestjs/common'
import { createHash, randomBytes } from 'crypto'
import type { AccountService } from '@/modules/users/services/account.service'
import type { PrismaService } from '@/shared/prisma/prisma.service'

@Injectable()
export class PasswordResetService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly accountService: AccountService,
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

		await this.prisma.password_reset_token.deleteMany({
			where: { account_id: account.id },
		})

		const token = this.generateToken()
		const hashedToken = this.hashToken(token)
		const expiresAt = new Date(Date.now() + 60 * 60 * 1000)

		await this.prisma.password_reset_token.create({
			data: {
				account_id: account.id,
				token: hashedToken,
				expires_at: expiresAt,
			},
		})

		console.log(`[PASSWORD RESET] Token for ${email}: ${token}`)

		return { success: true, token }
	}

	async resetPassword(token: string, newPassword: string): Promise<boolean> {
		const hashedToken = this.hashToken(token)

		const resetToken = await this.prisma.password_reset_token.findFirst({
			where: {
				token: hashedToken,
				expires_at: { gt: new Date() },
				used_at: null,
			},
		})

		if (!resetToken) {
			return false
		}

		const salt = randomBytes(16).toString('hex')
		const hashedPassword = createHash('sha256')
			.update(newPassword + salt)
			.digest('hex')

		await this.prisma.$transaction([
			this.prisma.account.update({
				where: { id: resetToken.account_id },
				data: { password: hashedPassword, salt },
			}),
			this.prisma.password_reset_token.update({
				where: { id: resetToken.id },
				data: { used_at: new Date() },
			}),
		])

		return true
	}
}
