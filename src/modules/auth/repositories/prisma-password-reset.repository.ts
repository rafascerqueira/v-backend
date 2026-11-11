import { Injectable } from '@nestjs/common'
import { PrismaService } from '@/shared/prisma/prisma.service'
import type {
	PasswordResetRepository,
	ResetTokenRecord,
} from '@/shared/repositories/password-reset.repository'
import { AccountSnapshotStore } from '@/shared/session/account-snapshot.store'

@Injectable()
export class PrismaPasswordResetRepository implements PasswordResetRepository {
	constructor(
		private readonly prisma: PrismaService,
		private readonly accountSnapshots: AccountSnapshotStore,
	) {}

	async deleteTokensByAccountId(accountId: string): Promise<void> {
		await this.prisma.password_reset_token.deleteMany({
			where: { account_id: accountId },
		})
	}

	async createToken(data: { account_id: string; token: string; expires_at: Date }): Promise<void> {
		await this.prisma.password_reset_token.create({ data })
	}

	async findValidToken(hashedToken: string): Promise<ResetTokenRecord | null> {
		return this.prisma.password_reset_token.findFirst({
			where: {
				token: hashedToken,
				expires_at: { gt: new Date() },
				used_at: null,
			},
		}) as unknown as ResetTokenRecord | null
	}

	async resetPasswordTransaction(
		accountId: string,
		tokenId: number,
		hashedPassword: string,
		salt: string,
	): Promise<void> {
		await this.prisma.$transaction([
			this.prisma.account.update({
				where: { id: accountId },
				// Whoever asked for the reset may not be who holds the open sessions:
				// a reset ends all of them, in the same write as the new password.
				data: { password: hashedPassword, salt, session_version: { increment: 1 } },
			}),
			this.prisma.password_reset_token.update({
				where: { id: tokenId },
				data: { used_at: new Date() },
			}),
		])
		await this.accountSnapshots.invalidate(accountId)
	}
}
