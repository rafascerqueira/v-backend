export interface SystemSetting {
	key: string
	value: string
	type: string
}

export const SETTINGS_REPOSITORY = Symbol('SETTINGS_REPOSITORY')

export interface SettingsRepository {
	findByKey(key: string): Promise<SystemSetting | null>
	upsert(key: string, value: string, type: string): Promise<SystemSetting>
	deleteByKey(key: string): Promise<boolean>
	findAll(): Promise<SystemSetting[]>
}
