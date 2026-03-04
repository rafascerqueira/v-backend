import { Injectable } from '@nestjs/common'
import { PrismaService } from '@/shared/prisma/prisma.service'
import type {
	EmailVerificationRepository,
	VerificationTokenWithAccount,
} from '@/shared/repositories/email-verification.repository'

@Injectable()
export class PrismaEmailVerificationRepository implements EmailVerificationRepository {
	constructor(private readonly prisma: PrismaService) {}

	async deleteTokensByAccountId(accountId: string): Promise<void> {
		await this.prisma.email_verification_token.deleteMany({
			where: { account_id: accountId },
		})
	}

	async createToken(data: { account_id: string; token: string; expires_at: Date }): Promise<void> {
		await this.prisma.email_verification_token.create({ data })
	}

	async findValidToken(hashedToken: string): Promise<VerificationTokenWithAccount | null> {
		return this.prisma.email_verification_token.findFirst({
			where: {
				token: hashedToken,
				expires_at: { gt: new Date() },
				used_at: null,
			},
			include: {
				account: {
					select: {
						email: true,
						name: true,
						email_verified: true,
					},
				},
			},
		}) as unknown as VerificationTokenWithAccount | null
	}

	async verifyEmailTransaction(accountId: string, tokenId: number): Promise<void> {
		await this.prisma.$transaction([
			this.prisma.account.update({
				where: { id: accountId },
				data: {
					email_verified: true,
					email_verified_at: new Date(),
				},
			}),
			this.prisma.email_verification_token.update({
				where: { id: tokenId },
				data: { used_at: new Date() },
			}),
		])
	}

	async findAccountByEmail(email: string): Promise<{
		id: string
		email: string
		name: string
		email_verified: boolean
	} | null> {
		return this.prisma.account.findUnique({
			where: { email },
			select: { id: true, email: true, name: true, email_verified: true },
		})
	}
}
