/**
 * SettingsController unit tests
 * Covers: GET /admin/settings, /promotions, /promotions/unlimited-period,
 *         /promotions/promotional-period, deprecated /free-period, CRUD by key
 * Guards mocked: JwtAuthGuard, RolesGuard
 */

import { BadRequestException } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard'
import { RolesGuard } from '@/modules/auth/guards/roles.guard'
import { SettingsService } from '../services/settings.service'
import { SettingsController } from './settings.controller'

const serviceMock = {
	getAll: jest.fn(),
	get: jest.fn(),
	set: jest.fn(),
	delete: jest.fn(),
	getUnlimitedPeriodWindow: jest.fn(),
	setUnlimitedPeriodWindow: jest.fn(),
	getPromotionalPeriod: jest.fn(),
	setPromotionalPeriod: jest.fn(),
	setFreePeriodEndDate: jest.fn(),
	setEarlyAdopterDiscount: jest.fn(),
	getPlanGrantQuotas: jest.fn(),
	setPlanGrantQuotas: jest.fn(),
}

describe('SettingsController', () => {
	let controller: SettingsController

	beforeEach(async () => {
		const module = await Test.createTestingModule({
			controllers: [SettingsController],
			providers: [{ provide: SettingsService, useValue: serviceMock }],
		})
			.overrideGuard(JwtAuthGuard)
			.useValue({ canActivate: () => true })
			.overrideGuard(RolesGuard)
			.useValue({ canActivate: () => true })
			.compile()

		controller = module.get(SettingsController)
		jest.clearAllMocks()
	})

	describe('getAll', () => {
		it('should return all settings as a flat key-value map', async () => {
			serviceMock.getAll.mockResolvedValueOnce([
				{ key: 'maintenance', value: 'false', type: 'boolean', parsed: false },
			])

			const result = await controller.getAll()

			expect(result).toEqual({ maintenance: false })
		})

		it('should normalise date settings to YYYY-MM-DD', async () => {
			serviceMock.getAll.mockResolvedValueOnce([
				{
					key: 'unlimited_period_end_date',
					value: '2026-02-28',
					type: 'date',
					parsed: new Date('2026-02-28T00:00:00.000Z'),
				},
			])

			const result = await controller.getAll()
			expect(result).toEqual({ unlimited_period_end_date: '2026-02-28' })
		})
	})

	describe('updateAll', () => {
		it('should call set for each key with proper type', async () => {
			serviceMock.set.mockResolvedValue(undefined)
			serviceMock.getAll.mockResolvedValueOnce([])

			await controller.updateAll({
				free_plan_products_limit: 50,
				free_plan_customers_limit: 100,
			})

			expect(serviceMock.set).toHaveBeenCalledWith('free_plan_products_limit', 50, 'number')
			expect(serviceMock.set).toHaveBeenCalledWith('free_plan_customers_limit', 100, 'number')
		})

		it('should default to string for unknown keys', async () => {
			serviceMock.set.mockResolvedValue(undefined)
			serviceMock.getAll.mockResolvedValueOnce([])

			await controller.updateAll({ custom_key: 'val' })

			expect(serviceMock.set).toHaveBeenCalledWith('custom_key', 'val', 'string')
		})
	})

	describe('getPromotions', () => {
		it('should return both windows', async () => {
			const unlimited = {
				startDate: new Date('2026-06-01'),
				endDate: new Date('2026-12-31'),
				isActive: true,
			}
			const promo = {
				startDate: null,
				endDate: null,
				discountPercent: 20,
				isActive: false,
			}
			serviceMock.getUnlimitedPeriodWindow.mockResolvedValueOnce(unlimited)
			serviceMock.getPromotionalPeriod.mockResolvedValueOnce(promo)

			const result = await controller.getPromotions()

			expect(result).toEqual({
				unlimitedPeriod: unlimited,
				promotionalPeriod: promo,
			})
		})
	})

	describe('setUnlimitedPeriod', () => {
		it('should accept null/null to clear the window', async () => {
			serviceMock.setUnlimitedPeriodWindow.mockResolvedValueOnce(undefined)
			serviceMock.getUnlimitedPeriodWindow.mockResolvedValueOnce({
				startDate: null,
				endDate: null,
				isActive: false,
			})

			await controller.setUnlimitedPeriod({ startDate: null, endDate: null })

			expect(serviceMock.setUnlimitedPeriodWindow).toHaveBeenCalledWith({
				startDate: null,
				endDate: null,
			})
		})

		it('should reject mismatched null/value', async () => {
			await expect(
				controller.setUnlimitedPeriod({ startDate: '2026-01-01', endDate: null }),
			).rejects.toBeInstanceOf(BadRequestException)
		})

		it('should reject when startDate >= endDate', async () => {
			await expect(
				controller.setUnlimitedPeriod({ startDate: '2026-12-01', endDate: '2026-11-01' }),
			).rejects.toBeInstanceOf(BadRequestException)
		})

		it('should set window when payload is valid', async () => {
			serviceMock.setUnlimitedPeriodWindow.mockResolvedValueOnce(undefined)
			serviceMock.getUnlimitedPeriodWindow.mockResolvedValueOnce({
				startDate: new Date('2026-06-01'),
				endDate: new Date('2026-12-31'),
				isActive: false,
			})

			await controller.setUnlimitedPeriod({
				startDate: '2026-06-01',
				endDate: '2026-12-31',
			})

			expect(serviceMock.setUnlimitedPeriodWindow).toHaveBeenCalled()
		})
	})

	describe('setPromotionalPeriod', () => {
		it('should reject discount out of range', async () => {
			await expect(
				controller.setPromotionalPeriod({
					startDate: null,
					endDate: null,
					discountPercent: 150,
				}),
			).rejects.toBeInstanceOf(BadRequestException)
		})

		it('should set when payload valid', async () => {
			serviceMock.setPromotionalPeriod.mockResolvedValueOnce(undefined)
			serviceMock.getPromotionalPeriod.mockResolvedValueOnce({
				startDate: new Date('2026-06-01'),
				endDate: new Date('2026-09-01'),
				discountPercent: 25,
				isActive: false,
			})

			await controller.setPromotionalPeriod({
				startDate: '2026-06-01',
				endDate: '2026-09-01',
				discountPercent: 25,
			})

			expect(serviceMock.setPromotionalPeriod).toHaveBeenCalled()
		})
	})

	describe('plan-grant-quotas', () => {
		it('should return current quotas', async () => {
			serviceMock.getPlanGrantQuotas.mockResolvedValueOnce({
				pro: 10,
				enterprise: 3,
			})

			const result = await controller.getPlanGrantQuotas()

			expect(result).toEqual({ pro: 10, enterprise: 3 })
		})

		it('should reject negative values', async () => {
			await expect(
				controller.setPlanGrantQuotas({ pro: -5, enterprise: 0 }),
			).rejects.toBeInstanceOf(BadRequestException)
		})

		it('should set valid quotas', async () => {
			serviceMock.setPlanGrantQuotas.mockResolvedValueOnce(undefined)
			serviceMock.getPlanGrantQuotas.mockResolvedValueOnce({
				pro: 25,
				enterprise: 5,
			})

			const result = await controller.setPlanGrantQuotas({
				pro: 25,
				enterprise: 5,
			})

			expect(serviceMock.setPlanGrantQuotas).toHaveBeenCalledWith({
				pro: 25,
				enterprise: 5,
			})
			expect(result.pro).toBe(25)
		})
	})

	describe('getFreePeriod (deprecated alias)', () => {
		it('should return legacy shape from new windows', async () => {
			serviceMock.getUnlimitedPeriodWindow.mockResolvedValueOnce({
				startDate: null,
				endDate: new Date('2026-02-28'),
				isActive: true,
			})
			serviceMock.getPromotionalPeriod.mockResolvedValueOnce({
				startDate: null,
				endDate: null,
				discountPercent: 20,
				isActive: false,
			})

			const result = await controller.getFreePeriod()

			expect(result).toMatchObject({
				isActive: true,
				earlyAdopterDiscount: 20,
			})
			expect(result.endDate).toBeInstanceOf(Date)
		})
	})

	describe('setFreePeriod (deprecated alias)', () => {
		it('should delegate to legacy setters', async () => {
			serviceMock.setFreePeriodEndDate.mockResolvedValueOnce(undefined)
			serviceMock.setEarlyAdopterDiscount.mockResolvedValueOnce(undefined)
			serviceMock.getUnlimitedPeriodWindow.mockResolvedValueOnce({
				startDate: null,
				endDate: new Date('2026-03-31'),
				isActive: true,
			})
			serviceMock.getPromotionalPeriod.mockResolvedValueOnce({
				startDate: null,
				endDate: null,
				discountPercent: 25,
				isActive: false,
			})

			await controller.setFreePeriod({
				endDate: '2026-03-31T23:59:59Z',
				earlyAdopterDiscount: 25,
			})

			expect(serviceMock.setFreePeriodEndDate).toHaveBeenCalled()
			expect(serviceMock.setEarlyAdopterDiscount).toHaveBeenCalledWith(25)
		})
	})

	describe('CRUD by key', () => {
		it('should get a setting', async () => {
			serviceMock.get.mockResolvedValueOnce('some-value')
			const result = await controller.get('feature_flag')
			expect(result).toBe('some-value')
		})

		it('should set a setting', async () => {
			serviceMock.set.mockResolvedValueOnce({ key: 'k', value: '5' })
			await controller.set('k', { value: '5', type: 'string' })
			expect(serviceMock.set).toHaveBeenCalledWith('k', '5', 'string')
		})

		it('should default to string type', async () => {
			serviceMock.set.mockResolvedValueOnce({})
			await controller.set('k', { value: 'v' })
			expect(serviceMock.set).toHaveBeenCalledWith('k', 'v', 'string')
		})

		it('should delete a setting', async () => {
			serviceMock.delete.mockResolvedValueOnce(true)
			const result = await controller.delete('k')
			expect(result).toEqual({ deleted: true })
		})
	})
})
