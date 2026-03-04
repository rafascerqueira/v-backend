import { Injectable } from '@nestjs/common'
import { PrismaService } from '@/shared/prisma/prisma.service'
import type {
	StoreSettingsData,
	StoreSettingsRepository,
	StoreSettingsUpdate,
} from '@/shared/repositories/store-settings.repository'

@Injectable()
export class PrismaStoreSettingsRepository implements StoreSettingsRepository {
	constructor(private readonly prisma: PrismaService) {}

	async findByAccountId(accountId: string): Promise<StoreSettingsData | null> {
		return this.prisma.account.findUnique({
			where: { id: accountId },
			select: {
				id: true,
				name: true,
				store_slug: true,
				store_name: true,
				store_description: true,
				store_logo: true,
				store_banner: true,
				store_phone: true,
				store_whatsapp: true,
			},
		}) as unknown as StoreSettingsData | null
	}

	async findSlugConflict(slug: string, excludeId: string): Promise<boolean> {
		const existing = await this.prisma.account.findFirst({
			where: {
				store_slug: slug,
				NOT: { id: excludeId },
			},
		})
		return !!existing
	}

	async updateSettings(
		accountId: string,
		data: Record<string, unknown>,
	): Promise<StoreSettingsUpdate> {
		return this.prisma.account.update({
			where: { id: accountId },
			data: data as any,
			select: {
				id: true,
				store_slug: true,
				store_name: true,
				store_description: true,
				store_phone: true,
				store_whatsapp: true,
			},
		}) as unknown as StoreSettingsUpdate
	}

	async updateLogo(accountId: string, logoUrl: string): Promise<{ store_logo: string | null }> {
		return this.prisma.account.update({
			where: { id: accountId },
			data: { store_logo: logoUrl },
			select: { store_logo: true },
		})
	}

	async updateBanner(
		accountId: string,
		bannerUrl: string,
	): Promise<{ store_banner: string | null }> {
		return this.prisma.account.update({
			where: { id: accountId },
			data: { store_banner: bannerUrl },
			select: { store_banner: true },
		})
	}

	async findSlugAndName(
		accountId: string,
	): Promise<{ store_slug: string | null; name: string } | null> {
		return this.prisma.account.findUnique({
			where: { id: accountId },
			select: { store_slug: true, name: true },
		})
	}
}
