export interface StoreSettingsData {
	id: string
	store_slug: string | null
	store_name: string | null
	store_description: string | null
	store_logo: string | null
	store_banner: string | null
	store_phone: string | null
	store_whatsapp: string | null
	name: string
}

export interface StoreSettingsUpdate {
	id: string
	store_slug: string | null
	store_name: string | null
	store_description: string | null
	store_phone: string | null
	store_whatsapp: string | null
}

export const STORE_SETTINGS_REPOSITORY = Symbol('STORE_SETTINGS_REPOSITORY')

export interface StoreSettingsRepository {
	findByAccountId(accountId: string): Promise<StoreSettingsData | null>
	findSlugConflict(slug: string, excludeId: string): Promise<boolean>
	updateSettings(accountId: string, data: Record<string, unknown>): Promise<StoreSettingsUpdate>
	updateLogo(accountId: string, logoUrl: string): Promise<{ store_logo: string | null }>
	updateBanner(accountId: string, bannerUrl: string): Promise<{ store_banner: string | null }>
	findSlugAndName(
		accountId: string,
	): Promise<{ store_slug: string | null; store_name: string | null; name: string } | null>
}
