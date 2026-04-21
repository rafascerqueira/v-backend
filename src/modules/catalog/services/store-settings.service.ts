import {
	BadRequestException,
	ConflictException,
	Inject,
	Injectable,
	NotFoundException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { generateUniqueSlug, RESERVED_SLUGS } from '@/shared/catalog/slug-generator'
import {
	STORE_SETTINGS_REPOSITORY,
	type StoreSettingsRepository,
} from '@/shared/repositories/store-settings.repository'

interface UpdateStoreSettings {
	store_slug?: string
	store_name?: string
	store_description?: string
	store_phone?: string
	store_whatsapp?: string
}

@Injectable()
export class StoreSettingsService {
	private readonly frontendUrl: string

	constructor(
		@Inject(STORE_SETTINGS_REPOSITORY)
		private readonly storeSettingsRepository: StoreSettingsRepository,
		readonly configService: ConfigService,
	) {
		this.frontendUrl = configService.get<string>('frontendUrl', 'http://localhost:3000')
	}

	async getSettings(sellerId: string) {
		const account = await this.storeSettingsRepository.findByAccountId(sellerId)

		if (!account) {
			throw new NotFoundException('Conta não encontrada')
		}

		const slugSuggestion = await this.generateSlugSuggestion(
			account.store_name,
			account.name,
			sellerId,
		)

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
			catalogUrl: account.store_slug ? `${this.frontendUrl}/loja/${account.store_slug}` : null,
			slugSuggestion,
		}
	}

	async updateSettings(sellerId: string, data: UpdateStoreSettings) {
		if (data.store_slug) {
			if (RESERVED_SLUGS.has(data.store_slug.toLowerCase())) {
				throw new BadRequestException('Este slug não está disponível')
			}

			const conflict = await this.storeSettingsRepository.findSlugConflict(
				data.store_slug,
				sellerId,
			)

			if (conflict) {
				throw new ConflictException('Este slug já está em uso')
			}
		}

		const updateData: Record<string, unknown> = {}
		if (data.store_slug !== undefined) updateData.store_slug = data.store_slug
		if (data.store_name !== undefined) updateData.store_name = data.store_name
		if (data.store_description !== undefined) updateData.store_description = data.store_description
		if (data.store_phone !== undefined) updateData.store_phone = data.store_phone
		if (data.store_whatsapp !== undefined) updateData.store_whatsapp = data.store_whatsapp

		const updated = await this.storeSettingsRepository.updateSettings(sellerId, updateData)

		return {
			...updated,
			catalogUrl: updated.store_slug ? `${this.frontendUrl}/loja/${updated.store_slug}` : null,
			message: 'Configurações atualizadas com sucesso',
		}
	}

	async updateStoreLogo(sellerId: string, logoUrl: string) {
		return this.storeSettingsRepository.updateLogo(sellerId, logoUrl)
	}

	async updateStoreBanner(sellerId: string, bannerUrl: string) {
		return this.storeSettingsRepository.updateBanner(sellerId, bannerUrl)
	}

	async getPreviewLink(sellerId: string) {
		const account = await this.storeSettingsRepository.findSlugAndName(sellerId)

		if (!account) {
			throw new NotFoundException('Conta não encontrada')
		}

		const baseUrl = this.frontendUrl

		return {
			hasSlug: !!account.store_slug,
			slug: account.store_slug,
			catalogUrl: account.store_slug ? `${baseUrl}/loja/${account.store_slug}` : null,
			suggestion: account.store_slug
				? null
				: await this.generateSlugSuggestion(account.store_name, account.name, sellerId),
		}
	}

	private generateSlugSuggestion(
		storeName: string | null,
		personalName: string,
		excludeId: string,
	): Promise<string> {
		return generateUniqueSlug(
			(slug) => this.storeSettingsRepository.findSlugConflict(slug, excludeId),
			storeName,
			personalName,
		)
	}
}
