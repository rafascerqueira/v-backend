import { BadRequestException, Inject, Injectable } from '@nestjs/common'
import {
	SETTINGS_REPOSITORY,
	type SettingsRepository,
} from '@/shared/repositories/settings.repository'

export const SETTINGS_KEYS = {
	FREE_PERIOD_END_DATE: 'free_period_end_date',
	EARLY_ADOPTER_DISCOUNT: 'early_adopter_discount',
	MAINTENANCE_MODE: 'maintenance_mode',
	UNLIMITED_PERIOD_START_DATE: 'unlimited_period_start_date',
	UNLIMITED_PERIOD_END_DATE: 'unlimited_period_end_date',
	PROMOTIONAL_PERIOD_START_DATE: 'promotional_period_start_date',
	PROMOTIONAL_PERIOD_END_DATE: 'promotional_period_end_date',
	PROMOTIONAL_PERIOD_DISCOUNT_PERCENT: 'promotional_period_discount_percent',
	PLAN_GRANT_PRO_QUOTA: 'plan_grant_pro_quota',
	PLAN_GRANT_ENTERPRISE_QUOTA: 'plan_grant_enterprise_quota',
} as const

type SettingType = 'string' | 'number' | 'boolean' | 'date' | 'json'

export interface SettingValue {
	key: string
	value: string
	type: SettingType
	parsed: unknown
}

export interface UnlimitedPeriodWindow {
	startDate: Date | null
	endDate: Date | null
	isActive: boolean
}

export interface PromotionalPeriodWindow {
	startDate: Date | null
	endDate: Date | null
	discountPercent: number
	isActive: boolean
}

export interface PlanGrantQuotas {
	pro: number
	enterprise: number
}

@Injectable()
export class SettingsService {
	constructor(
		@Inject(SETTINGS_REPOSITORY) private readonly settingsRepository: SettingsRepository,
	) {}

	private parseValue(value: string, type: SettingType): unknown {
		switch (type) {
			case 'number':
				return Number(value)
			case 'boolean':
				return value === 'true'
			case 'date':
				return new Date(value)
			case 'json':
				try {
					return JSON.parse(value)
				} catch {
					return null
				}
			default:
				return value
		}
	}

	private stringifyValue(value: unknown, type: SettingType): string {
		switch (type) {
			case 'date':
				return value instanceof Date ? value.toISOString() : String(value)
			case 'json':
				return JSON.stringify(value)
			case 'boolean':
				return value ? 'true' : 'false'
			default:
				return String(value)
		}
	}

	async get(key: string): Promise<SettingValue | null> {
		const setting = await this.settingsRepository.findByKey(key)

		if (!setting) return null

		return {
			key: setting.key,
			value: setting.value,
			type: setting.type as SettingType,
			parsed: this.parseValue(setting.value, setting.type as SettingType),
		}
	}

	async set(key: string, value: unknown, type: SettingType = 'string'): Promise<SettingValue> {
		const stringValue = this.stringifyValue(value, type)

		const setting = await this.settingsRepository.upsert(key, stringValue, type)

		return {
			key: setting.key,
			value: setting.value,
			type: setting.type as SettingType,
			parsed: this.parseValue(setting.value, setting.type as SettingType),
		}
	}

	async delete(key: string): Promise<boolean> {
		return this.settingsRepository.deleteByKey(key)
	}

	async getAll(): Promise<SettingValue[]> {
		const settings = await this.settingsRepository.findAll()
		return settings.map((s) => ({
			key: s.key,
			value: s.value,
			type: s.type as SettingType,
			parsed: this.parseValue(s.value, s.type as SettingType),
		}))
	}

	async getFreePeriodEndDate(): Promise<Date> {
		const window = await this.getUnlimitedPeriodWindow()
		return window.endDate ?? new Date('2026-02-28T23:59:59Z')
	}

	async setFreePeriodEndDate(date: Date): Promise<void> {
		await this.set(SETTINGS_KEYS.UNLIMITED_PERIOD_END_DATE, date, 'date')
	}

	async isFreePeriodActive(): Promise<boolean> {
		const window = await this.getUnlimitedPeriodWindow()
		return window.isActive
	}

	async getEarlyAdopterDiscount(): Promise<number> {
		const promo = await this.getPromotionalPeriod()
		return promo.discountPercent
	}

	async setEarlyAdopterDiscount(percent: number): Promise<void> {
		await this.set(SETTINGS_KEYS.PROMOTIONAL_PERIOD_DISCOUNT_PERCENT, percent, 'number')
	}

	async getUnlimitedPeriodWindow(): Promise<UnlimitedPeriodWindow> {
		const [startSetting, endSetting, legacyEndSetting] = await Promise.all([
			this.get(SETTINGS_KEYS.UNLIMITED_PERIOD_START_DATE),
			this.get(SETTINGS_KEYS.UNLIMITED_PERIOD_END_DATE),
			this.get(SETTINGS_KEYS.FREE_PERIOD_END_DATE),
		])

		let endDate = endSetting?.parsed instanceof Date ? endSetting.parsed : null

		if (!endDate && legacyEndSetting?.parsed instanceof Date) {
			endDate = legacyEndSetting.parsed
			await this.set(SETTINGS_KEYS.UNLIMITED_PERIOD_END_DATE, endDate, 'date')
			await this.delete(SETTINGS_KEYS.FREE_PERIOD_END_DATE)
		}

		const startDate = startSetting?.parsed instanceof Date ? startSetting.parsed : null
		const now = new Date()
		const isActive = Boolean(endDate && now < endDate && (!startDate || now >= startDate))

		return { startDate, endDate, isActive }
	}

	async setUnlimitedPeriodWindow({
		startDate,
		endDate,
	}: {
		startDate: Date | null
		endDate: Date | null
	}): Promise<void> {
		if (startDate === null && endDate === null) {
			await Promise.all([
				this.delete(SETTINGS_KEYS.UNLIMITED_PERIOD_START_DATE),
				this.delete(SETTINGS_KEYS.UNLIMITED_PERIOD_END_DATE),
				this.delete(SETTINGS_KEYS.FREE_PERIOD_END_DATE),
			])
			return
		}

		if (!startDate || !endDate) {
			throw new BadRequestException(
				'Both startDate and endDate must be provided to set the unlimited period',
			)
		}

		if (startDate >= endDate) {
			throw new BadRequestException('startDate must be before endDate')
		}

		await Promise.all([
			this.set(SETTINGS_KEYS.UNLIMITED_PERIOD_START_DATE, startDate, 'date'),
			this.set(SETTINGS_KEYS.UNLIMITED_PERIOD_END_DATE, endDate, 'date'),
			this.delete(SETTINGS_KEYS.FREE_PERIOD_END_DATE),
		])
	}

	async getPromotionalPeriod(): Promise<PromotionalPeriodWindow> {
		const [startSetting, endSetting, discountSetting, legacyDiscount] = await Promise.all([
			this.get(SETTINGS_KEYS.PROMOTIONAL_PERIOD_START_DATE),
			this.get(SETTINGS_KEYS.PROMOTIONAL_PERIOD_END_DATE),
			this.get(SETTINGS_KEYS.PROMOTIONAL_PERIOD_DISCOUNT_PERCENT),
			this.get(SETTINGS_KEYS.EARLY_ADOPTER_DISCOUNT),
		])

		let discountPercent = 0
		if (discountSetting?.parsed != null) {
			discountPercent = discountSetting.parsed as number
		} else if (legacyDiscount?.parsed != null) {
			discountPercent = legacyDiscount.parsed as number
			await this.set(SETTINGS_KEYS.PROMOTIONAL_PERIOD_DISCOUNT_PERCENT, discountPercent, 'number')
			await this.delete(SETTINGS_KEYS.EARLY_ADOPTER_DISCOUNT)
		} else {
			discountPercent = 20
		}

		const startDate = startSetting?.parsed instanceof Date ? startSetting.parsed : null
		const endDate = endSetting?.parsed instanceof Date ? endSetting.parsed : null

		const now = new Date()
		const isActive = Boolean(
			startDate && endDate && now >= startDate && now < endDate && discountPercent > 0,
		)

		return { startDate, endDate, discountPercent, isActive }
	}

	async setPromotionalPeriod({
		startDate,
		endDate,
		discountPercent,
	}: {
		startDate: Date | null
		endDate: Date | null
		discountPercent: number
	}): Promise<void> {
		if (discountPercent < 0 || discountPercent > 100) {
			throw new BadRequestException('discountPercent must be between 0 and 100')
		}

		if (startDate === null && endDate === null) {
			await Promise.all([
				this.delete(SETTINGS_KEYS.PROMOTIONAL_PERIOD_START_DATE),
				this.delete(SETTINGS_KEYS.PROMOTIONAL_PERIOD_END_DATE),
				this.set(SETTINGS_KEYS.PROMOTIONAL_PERIOD_DISCOUNT_PERCENT, discountPercent, 'number'),
				this.delete(SETTINGS_KEYS.EARLY_ADOPTER_DISCOUNT),
			])
			return
		}

		if (!startDate || !endDate) {
			throw new BadRequestException(
				'Both startDate and endDate must be provided to set the promotional period',
			)
		}

		if (startDate >= endDate) {
			throw new BadRequestException('startDate must be before endDate')
		}

		await Promise.all([
			this.set(SETTINGS_KEYS.PROMOTIONAL_PERIOD_START_DATE, startDate, 'date'),
			this.set(SETTINGS_KEYS.PROMOTIONAL_PERIOD_END_DATE, endDate, 'date'),
			this.set(SETTINGS_KEYS.PROMOTIONAL_PERIOD_DISCOUNT_PERCENT, discountPercent, 'number'),
			this.delete(SETTINGS_KEYS.EARLY_ADOPTER_DISCOUNT),
		])
	}

	async getPlanGrantQuotas(): Promise<PlanGrantQuotas> {
		const [pro, enterprise] = await Promise.all([
			this.get(SETTINGS_KEYS.PLAN_GRANT_PRO_QUOTA),
			this.get(SETTINGS_KEYS.PLAN_GRANT_ENTERPRISE_QUOTA),
		])
		return {
			pro: pro?.parsed != null ? (pro.parsed as number) : 0,
			enterprise: enterprise?.parsed != null ? (enterprise.parsed as number) : 0,
		}
	}

	async setPlanGrantQuotas(quotas: PlanGrantQuotas): Promise<void> {
		if (
			!Number.isInteger(quotas.pro) ||
			!Number.isInteger(quotas.enterprise) ||
			quotas.pro < 0 ||
			quotas.enterprise < 0
		) {
			throw new BadRequestException('Quotas must be non-negative integers (0 = unlimited)')
		}
		await Promise.all([
			this.set(SETTINGS_KEYS.PLAN_GRANT_PRO_QUOTA, quotas.pro, 'number'),
			this.set(SETTINGS_KEYS.PLAN_GRANT_ENTERPRISE_QUOTA, quotas.enterprise, 'number'),
		])
	}

	async getEffectiveStartForAccount(
		windowStart: Date | null,
		accountCreatedAt: Date,
	): Promise<Date> {
		if (!windowStart) return accountCreatedAt
		return windowStart > accountCreatedAt ? windowStart : accountCreatedAt
	}
}
