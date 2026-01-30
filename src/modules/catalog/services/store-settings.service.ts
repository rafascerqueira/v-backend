import { ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '@/shared/prisma/prisma.service'

interface UpdateStoreSettings {
	store_slug?: string
	store_name?: string
	store_description?: string
	store_phone?: string
	store_whatsapp?: string
}

@Injectable()
export class StoreSettingsService {
	constructor(private readonly prisma: PrismaService) {}

	async getSettings(sellerId: string) {
		const account = await this.prisma.account.findUnique({
			where: { id: sellerId },
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
		})

		if (!account) {
			throw new NotFoundException('Conta não encontrada')
		}

		return {
			id: account.id,
			sellerName: account.name,
			slug: account.store_slug,
			name: account.store_name,
			description: account.store_description,
			logo: account.store_logo,
			banner: account.store_banner,
			phone: account.store_phone,
			whatsapp: account.store_whatsapp,
			catalogUrl: account.store_slug
				? `${process.env.FRONTEND_URL || 'http://localhost:3000'}/loja/${account.store_slug}`
				: null,
		}
	}

	async updateSettings(sellerId: string, data: UpdateStoreSettings) {
		if (data.store_slug) {
			const existing = await this.prisma.account.findFirst({
				where: {
					store_slug: data.store_slug,
					NOT: { id: sellerId },
				},
			})

			if (existing) {
				throw new ConflictException('Este slug já está em uso')
			}
		}

		const updated = await this.prisma.account.update({
			where: { id: sellerId },
			data: {
				...(data.store_slug !== undefined && { store_slug: data.store_slug }),
				...(data.store_name !== undefined && { store_name: data.store_name }),
				...(data.store_description !== undefined && { store_description: data.store_description }),
				...(data.store_phone !== undefined && { store_phone: data.store_phone }),
				...(data.store_whatsapp !== undefined && { store_whatsapp: data.store_whatsapp }),
			},
			select: {
				id: true,
				store_slug: true,
				store_name: true,
				store_description: true,
				store_phone: true,
				store_whatsapp: true,
			},
		})

		return {
			...updated,
			catalogUrl: updated.store_slug
				? `${process.env.FRONTEND_URL || 'http://localhost:3000'}/loja/${updated.store_slug}`
				: null,
			message: 'Configurações atualizadas com sucesso',
		}
	}

	async updateStoreLogo(sellerId: string, logoUrl: string) {
		return this.prisma.account.update({
			where: { id: sellerId },
			data: { store_logo: logoUrl },
			select: { store_logo: true },
		})
	}

	async updateStoreBanner(sellerId: string, bannerUrl: string) {
		return this.prisma.account.update({
			where: { id: sellerId },
			data: { store_banner: bannerUrl },
			select: { store_banner: true },
		})
	}

	async getPreviewLink(sellerId: string) {
		const account = await this.prisma.account.findUnique({
			where: { id: sellerId },
			select: { store_slug: true, name: true },
		})

		if (!account) {
			throw new NotFoundException('Conta não encontrada')
		}

		const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3000'

		return {
			hasSlug: !!account.store_slug,
			slug: account.store_slug,
			catalogUrl: account.store_slug ? `${baseUrl}/loja/${account.store_slug}` : null,
			genericUrl: `${baseUrl}/catalog`,
			suggestion: account.store_slug
				? null
				: this.generateSlugSuggestion(account.name),
		}
	}

	private generateSlugSuggestion(name: string): string {
		return name
			.toLowerCase()
			.normalize('NFD')
			.replace(/[\u0300-\u036f]/g, '')
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.substring(0, 50)
	}
}
