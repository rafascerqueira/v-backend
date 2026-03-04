import { Injectable } from '@nestjs/common'
import { PrismaService } from '@/shared/prisma/prisma.service'
import type {
	TwoFactorAccountInfo,
	TwoFactorBackupInfo,
	TwoFactorRepository,
	TwoFactorSecretInfo,
} from '@/shared/repositories/two-factor.repository'

@Injectable()
export class PrismaTwoFactorRepository implements TwoFactorRepository {
	constructor(private readonly prisma: PrismaService) {}

	async findAccountEmailAnd2fa(userId: string): Promise<TwoFactorAccountInfo | null> {
		return this.prisma.account.findUnique({
			where: { id: userId },
			select: { email: true, two_factor_enabled: true },
		})
	}

	async findAccount2faSecret(userId: string): Promise<TwoFactorSecretInfo | null> {
		return this.prisma.account.findUnique({
			where: { id: userId },
			select: { two_factor_secret: true, two_factor_enabled: true },
		})
	}

	async findAccount2faBackup(userId: string): Promise<TwoFactorBackupInfo | null> {
		return this.prisma.account.findUnique({
			where: { id: userId },
			select: { two_factor_backup: true, two_factor_enabled: true },
		})
	}

	async findAccount2faEnabled(userId: string): Promise<boolean> {
		const user = await this.prisma.account.findUnique({
			where: { id: userId },
			select: { two_factor_enabled: true },
		})
		return user?.two_factor_enabled ?? false
	}

	async updateTwoFactorSecret(userId: string, secret: string): Promise<void> {
		await this.prisma.account.update({
			where: { id: userId },
			data: { two_factor_secret: secret },
		})
	}

	async enableTwoFactor(userId: string): Promise<void> {
		await this.prisma.account.update({
			where: { id: userId },
			data: { two_factor_enabled: true },
		})
	}

	async disableTwoFactor(userId: string): Promise<void> {
		await this.prisma.account.update({
			where: { id: userId },
			data: {
				two_factor_enabled: false,
				two_factor_secret: null,
			},
		})
	}

	async updateBackupCodes(userId: string, codes: string[]): Promise<void> {
		await this.prisma.account.update({
			where: { id: userId },
			data: { two_factor_backup: codes },
		})
	}

	async findBackupCodesCount(userId: string): Promise<number> {
		const user = await this.prisma.account.findUnique({
			where: { id: userId },
			select: { two_factor_backup: true },
		})
		return (user?.two_factor_backup as string[])?.length || 0
	}
}
