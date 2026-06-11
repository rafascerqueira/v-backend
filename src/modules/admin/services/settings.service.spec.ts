/**
 * SettingsService unit tests
 * Covers: get, set, delete, getAll, free-period legacy wrappers,
 *         getUnlimitedPeriodWindow, setUnlimitedPeriodWindow,
 *         getPromotionalPeriod, setPromotionalPeriod
 */
import { Test } from '@nestjs/testing'
import {
	SETTINGS_REPOSITORY,
	type SettingsRepository,
} from '@/shared/repositories/settings.repository'
import { SETTINGS_KEYS, SettingsService } from './settings.service'

const repositoryMock: jest.Mocked<SettingsRepository> = {
	findByKey: jest.fn(),
	upsert: jest.fn(),
	deleteByKey: jest.fn(),
	findAll: jest.fn(),
}

function settingRow(key: string, value: string, type: string) {
	return { key, value, type }
}

describe('SettingsService', () => {
	let service: SettingsService

	beforeEach(async () => {
		const module = await Test.createTestingModule({
			providers: [SettingsService, { provide: SETTINGS_REPOSITORY, useValue: repositoryMock }],
		}).compile()

		service = module.get(SettingsService)
		jest.clearAllMocks()
		repositoryMock.findByKey.mockResolvedValue(null)
		repositoryMock.upsert.mockImplementation(async (key, value, type) => ({ key, value, type }))
		repositoryMock.deleteByKey.mockResolvedValue(true)
	})

	describe('get', () => {
		it('should return null when key does not exist', async () => {
			repositoryMock.findByKey.mockResolvedValueOnce(null)
			const result = await service.get('missing_key')
			expect(result).toBeNull()
		})

		it('should parse a number type setting', async () => {
			repositoryMock.findByKey.mockResolvedValueOnce(settingRow('discount', '20', 'number'))
			const result = await service.get('discount')
			expect(result?.parsed).toBe(20)
		})

		it('should parse a boolean type setting', async () => {
			repositoryMock.findByKey.mockResolvedValueOnce(settingRow('maintenance', 'true', 'boolean'))
			const result = await service.get('maintenance')
			expect(result?.parsed).toBe(true)
		})

		it('should parse a date type setting', async () => {
			repositoryMock.findByKey.mockResolvedValueOnce(
				settingRow('date_key', '2026-01-01T00:00:00Z', 'date'),
			)
			const result = await service.get('date_key')
			expect(result?.parsed).toBeInstanceOf(Date)
		})

		it('should parse a json type setting', async () => {
			repositoryMock.findByKey.mockResolvedValueOnce(
				settingRow('json_key', '{"foo":"bar"}', 'json'),
			)
			const result = await service.get('json_key')
			expect(result?.parsed).toEqual({ foo: 'bar' })
		})

		it('should return null parsed when JSON is invalid', async () => {
			repositoryMock.findByKey.mockResolvedValueOnce(
				settingRow('bad_json', '{not valid json}', 'json'),
			)
			const result = await service.get('bad_json')
			expect(result?.parsed).toBeNull()
		})
	})

	describe('set', () => {
		it('should upsert string value', async () => {
			await service.set('name', 'Vendinhas', 'string')
			expect(repositoryMock.upsert).toHaveBeenCalledWith('name', 'Vendinhas', 'string')
		})

		it('should stringify numbers', async () => {
			await service.set('discount', 15, 'number')
			expect(repositoryMock.upsert).toHaveBeenCalledWith('discount', '15', 'number')
		})

		it('should stringify booleans', async () => {
			await service.set('flag', false, 'boolean')
			expect(repositoryMock.upsert).toHaveBeenCalledWith('flag', 'false', 'boolean')
		})

		it('should serialize Date as ISO string', async () => {
			const date = new Date('2026-12-31T00:00:00.000Z')
			await service.set('end_date', date, 'date')
			expect(repositoryMock.upsert).toHaveBeenCalledWith('end_date', date.toISOString(), 'date')
		})
	})

	describe('delete', () => {
		it('should return true when deleted', async () => {
			repositoryMock.deleteByKey.mockResolvedValueOnce(true)
			const result = await service.delete('some_key')
			expect(result).toBe(true)
		})

		it('should return false when not found', async () => {
			repositoryMock.deleteByKey.mockResolvedValueOnce(false)
			const result = await service.delete('missing')
			expect(result).toBe(false)
		})
	})

	describe('getAll', () => {
		it('should return all settings parsed', async () => {
			repositoryMock.findAll.mockResolvedValueOnce([
				settingRow('a', '1', 'number'),
				settingRow('b', 'true', 'boolean'),
			])
			const result = await service.getAll()
			expect(result).toHaveLength(2)
			expect(result[0].parsed).toBe(1)
			expect(result[1].parsed).toBe(true)
		})
	})

	describe('getUnlimitedPeriodWindow', () => {
		it('should return null window when no settings exist', async () => {
			repositoryMock.findByKey.mockResolvedValue(null)
			const window = await service.getUnlimitedPeriodWindow()
			expect(window).toEqual({ startDate: null, endDate: null, isActive: false })
		})

		it('should return active window when end date is in the future', async () => {
			const future = new Date(Date.now() + 24 * 60 * 60 * 1000)
			repositoryMock.findByKey.mockImplementation(async (key) => {
				if (key === SETTINGS_KEYS.UNLIMITED_PERIOD_END_DATE) {
					return settingRow(key, future.toISOString(), 'date')
				}
				return null
			})
			const window = await service.getUnlimitedPeriodWindow()
			expect(window.isActive).toBe(true)
			expect(window.endDate).toBeInstanceOf(Date)
		})

		it('should return inactive when end date is in the past', async () => {
			const past = new Date(Date.now() - 24 * 60 * 60 * 1000)
			repositoryMock.findByKey.mockImplementation(async (key) => {
				if (key === SETTINGS_KEYS.UNLIMITED_PERIOD_END_DATE) {
					return settingRow(key, past.toISOString(), 'date')
				}
				return null
			})
			const window = await service.getUnlimitedPeriodWindow()
			expect(window.isActive).toBe(false)
		})

		it('should respect start date when both are set', async () => {
			const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
			const farFuture = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000)
			repositoryMock.findByKey.mockImplementation(async (key) => {
				if (key === SETTINGS_KEYS.UNLIMITED_PERIOD_START_DATE) {
					return settingRow(key, future.toISOString(), 'date')
				}
				if (key === SETTINGS_KEYS.UNLIMITED_PERIOD_END_DATE) {
					return settingRow(key, farFuture.toISOString(), 'date')
				}
				return null
			})
			const window = await service.getUnlimitedPeriodWindow()
			expect(window.isActive).toBe(false)
		})

		it('should migrate legacy free_period_end_date to unlimited_period_end_date', async () => {
			const future = new Date(Date.now() + 24 * 60 * 60 * 1000)
			repositoryMock.findByKey.mockImplementation(async (key) => {
				if (key === SETTINGS_KEYS.FREE_PERIOD_END_DATE) {
					return settingRow(key, future.toISOString(), 'date')
				}
				return null
			})

			const window = await service.getUnlimitedPeriodWindow()

			expect(window.isActive).toBe(true)
			expect(repositoryMock.upsert).toHaveBeenCalledWith(
				SETTINGS_KEYS.UNLIMITED_PERIOD_END_DATE,
				future.toISOString(),
				'date',
			)
			expect(repositoryMock.deleteByKey).toHaveBeenCalledWith(SETTINGS_KEYS.FREE_PERIOD_END_DATE)
		})
	})

	describe('setUnlimitedPeriodWindow', () => {
		it('should clear all related keys when both dates are null', async () => {
			await service.setUnlimitedPeriodWindow({ startDate: null, endDate: null })
			expect(repositoryMock.deleteByKey).toHaveBeenCalledWith(
				SETTINGS_KEYS.UNLIMITED_PERIOD_START_DATE,
			)
			expect(repositoryMock.deleteByKey).toHaveBeenCalledWith(
				SETTINGS_KEYS.UNLIMITED_PERIOD_END_DATE,
			)
		})

		it('should reject when only one date is provided', async () => {
			await expect(
				service.setUnlimitedPeriodWindow({ startDate: new Date(), endDate: null }),
			).rejects.toThrow()
		})

		it('should reject when start >= end', async () => {
			const start = new Date('2026-12-01')
			const end = new Date('2026-11-01')
			await expect(
				service.setUnlimitedPeriodWindow({ startDate: start, endDate: end }),
			).rejects.toThrow()
		})

		it('should upsert both dates and clear legacy key', async () => {
			const start = new Date('2026-06-01')
			const end = new Date('2026-12-31')
			await service.setUnlimitedPeriodWindow({ startDate: start, endDate: end })
			expect(repositoryMock.upsert).toHaveBeenCalledWith(
				SETTINGS_KEYS.UNLIMITED_PERIOD_START_DATE,
				start.toISOString(),
				'date',
			)
			expect(repositoryMock.upsert).toHaveBeenCalledWith(
				SETTINGS_KEYS.UNLIMITED_PERIOD_END_DATE,
				end.toISOString(),
				'date',
			)
			expect(repositoryMock.deleteByKey).toHaveBeenCalledWith(SETTINGS_KEYS.FREE_PERIOD_END_DATE)
		})
	})

	describe('getPromotionalPeriod', () => {
		it('should return defaults when no keys exist', async () => {
			const result = await service.getPromotionalPeriod()
			expect(result.discountPercent).toBe(20)
			expect(result.isActive).toBe(false)
		})

		it('should be active when within window and percent > 0', async () => {
			const now = Date.now()
			const start = new Date(now - 24 * 60 * 60 * 1000)
			const end = new Date(now + 24 * 60 * 60 * 1000)
			repositoryMock.findByKey.mockImplementation(async (key) => {
				if (key === SETTINGS_KEYS.PROMOTIONAL_PERIOD_START_DATE) {
					return settingRow(key, start.toISOString(), 'date')
				}
				if (key === SETTINGS_KEYS.PROMOTIONAL_PERIOD_END_DATE) {
					return settingRow(key, end.toISOString(), 'date')
				}
				if (key === SETTINGS_KEYS.PROMOTIONAL_PERIOD_DISCOUNT_PERCENT) {
					return settingRow(key, '25', 'number')
				}
				return null
			})

			const result = await service.getPromotionalPeriod()
			expect(result.isActive).toBe(true)
			expect(result.discountPercent).toBe(25)
		})

		it('should migrate legacy early_adopter_discount', async () => {
			repositoryMock.findByKey.mockImplementation(async (key) => {
				if (key === SETTINGS_KEYS.EARLY_ADOPTER_DISCOUNT) {
					return settingRow(key, '30', 'number')
				}
				return null
			})

			const result = await service.getPromotionalPeriod()
			expect(result.discountPercent).toBe(30)
			expect(repositoryMock.upsert).toHaveBeenCalledWith(
				SETTINGS_KEYS.PROMOTIONAL_PERIOD_DISCOUNT_PERCENT,
				'30',
				'number',
			)
			expect(repositoryMock.deleteByKey).toHaveBeenCalledWith(SETTINGS_KEYS.EARLY_ADOPTER_DISCOUNT)
		})
	})

	describe('getPlanGrantQuotas', () => {
		it('should default to 0/0 when keys are absent', async () => {
			const quotas = await service.getPlanGrantQuotas()
			expect(quotas).toEqual({ pro: 0, enterprise: 0 })
		})

		it('should return stored values', async () => {
			repositoryMock.findByKey.mockImplementation(async (key) => {
				if (key === SETTINGS_KEYS.PLAN_GRANT_PRO_QUOTA) {
					return settingRow(key, '10', 'number')
				}
				if (key === SETTINGS_KEYS.PLAN_GRANT_ENTERPRISE_QUOTA) {
					return settingRow(key, '3', 'number')
				}
				return null
			})

			const quotas = await service.getPlanGrantQuotas()
			expect(quotas).toEqual({ pro: 10, enterprise: 3 })
		})
	})

	describe('setPlanGrantQuotas', () => {
		it('should reject negative values', async () => {
			await expect(service.setPlanGrantQuotas({ pro: -1, enterprise: 0 })).rejects.toThrow()
		})

		it('should reject non-integer values', async () => {
			await expect(service.setPlanGrantQuotas({ pro: 1.5, enterprise: 0 })).rejects.toThrow()
		})

		it('should upsert both keys', async () => {
			await service.setPlanGrantQuotas({ pro: 12, enterprise: 4 })

			expect(repositoryMock.upsert).toHaveBeenCalledWith(
				SETTINGS_KEYS.PLAN_GRANT_PRO_QUOTA,
				'12',
				'number',
			)
			expect(repositoryMock.upsert).toHaveBeenCalledWith(
				SETTINGS_KEYS.PLAN_GRANT_ENTERPRISE_QUOTA,
				'4',
				'number',
			)
		})
	})

	describe('setPromotionalPeriod', () => {
		it('should reject discount out of range', async () => {
			await expect(
				service.setPromotionalPeriod({
					startDate: null,
					endDate: null,
					discountPercent: 120,
				}),
			).rejects.toThrow()
		})

		it('should reject when only one date provided', async () => {
			await expect(
				service.setPromotionalPeriod({
					startDate: new Date(),
					endDate: null,
					discountPercent: 10,
				}),
			).rejects.toThrow()
		})

		it('should write all three keys and clear legacy', async () => {
			const start = new Date('2026-06-01')
			const end = new Date('2026-09-01')
			await service.setPromotionalPeriod({
				startDate: start,
				endDate: end,
				discountPercent: 35,
			})
			expect(repositoryMock.upsert).toHaveBeenCalledWith(
				SETTINGS_KEYS.PROMOTIONAL_PERIOD_DISCOUNT_PERCENT,
				'35',
				'number',
			)
			expect(repositoryMock.deleteByKey).toHaveBeenCalledWith(SETTINGS_KEYS.EARLY_ADOPTER_DISCOUNT)
		})
	})
})
