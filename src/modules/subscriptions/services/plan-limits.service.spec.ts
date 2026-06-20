/**
 * PlanLimitsService unit tests
 * Covers: getLimits, getUsageStats, canCreateProduct, canCreateCustomer, canCreateOrder,
 *         getUsageSummary
 * Verifies: unlimited plan bypass, at-limit rejection, under-limit approval, summary math
 */
import { Test } from '@nestjs/testing'
import { AccountExceptionService } from '@/modules/account-exceptions/services/account-exception.service'
import { SettingsService } from '@/modules/admin/services/settings.service'
import {
	PLAN_LIMITS_REPOSITORY,
	type PlanLimitsRepository,
} from '@/shared/repositories/plan-limits.repository'
import { PlanLimitsService } from './plan-limits.service'

const repositoryMock: jest.Mocked<PlanLimitsRepository> = {
	countProducts: jest.fn(),
	countCustomers: jest.fn(),
	countOrdersThisMonth: jest.fn(),
}

const settingsServiceMock = {
	get: jest.fn().mockResolvedValue(null),
	getUnlimitedPeriodWindow: jest.fn().mockResolvedValue({
		startDate: null,
		endDate: null,
		isActive: false,
	}),
	getPromotionalPeriod: jest.fn().mockResolvedValue({
		startDate: null,
		endDate: null,
		discountPercent: 20,
		isActive: false,
	}),
}

const exceptionServiceMock = {
	resolveActiveExceptions: jest.fn().mockResolvedValue({
		unlimitedWindow: null,
		planGrant: null,
		customLimits: null,
		billingAdjustment: null,
	}),
}

describe('PlanLimitsService', () => {
	let service: PlanLimitsService

	beforeEach(async () => {
		const module = await Test.createTestingModule({
			providers: [
				PlanLimitsService,
				{ provide: PLAN_LIMITS_REPOSITORY, useValue: repositoryMock },
				{ provide: SettingsService, useValue: settingsServiceMock },
				{ provide: AccountExceptionService, useValue: exceptionServiceMock },
			],
		}).compile()

		service = module.get(PlanLimitsService)
		jest.clearAllMocks()
		settingsServiceMock.get.mockResolvedValue(null)
		settingsServiceMock.getUnlimitedPeriodWindow.mockResolvedValue({
			startDate: null,
			endDate: null,
			isActive: false,
		})
		settingsServiceMock.getPromotionalPeriod.mockResolvedValue({
			startDate: null,
			endDate: null,
			discountPercent: 20,
			isActive: false,
		})
		exceptionServiceMock.resolveActiveExceptions.mockResolvedValue({
			unlimitedWindow: null,
			planGrant: null,
			customLimits: null,
			billingAdjustment: null,
		})
	})

	describe('hasFeature', () => {
		it('denies all gated features on the free plan', async () => {
			expect(await service.hasFeature('s', 'free', 'reports')).toBe(false)
			expect(await service.hasFeature('s', 'free', 'exportData')).toBe(false)
			expect(await service.hasFeature('s', 'free', 'multipleImages')).toBe(false)
			expect(await service.hasFeature('s', 'free', 'customBranding')).toBe(false)
		})

		it('grants Pro features but not enterprise-only ones on the pro plan', async () => {
			expect(await service.hasFeature('s', 'pro', 'reports')).toBe(true)
			expect(await service.hasFeature('s', 'pro', 'exportData')).toBe(true)
			expect(await service.hasFeature('s', 'pro', 'multipleImages')).toBe(true)
			expect(await service.hasFeature('s', 'pro', 'customBranding')).toBe(false)
		})

		it('grants every feature on the enterprise plan', async () => {
			expect(await service.hasFeature('s', 'enterprise', 'customBranding')).toBe(true)
			expect(await service.hasFeature('s', 'enterprise', 'apiAccess')).toBe(true)
		})

		it('lifts a free seller to Pro features during an active unlimited window', async () => {
			settingsServiceMock.getUnlimitedPeriodWindow.mockResolvedValue({
				startDate: null,
				endDate: null,
				isActive: true,
			})
			expect(await service.hasFeature('s', 'free', 'reports')).toBe(true)
			expect(await service.hasFeature('s', 'free', 'customBranding')).toBe(false)
		})

		it('respects an admin plan grant (free → enterprise features)', async () => {
			exceptionServiceMock.resolveActiveExceptions.mockResolvedValue({
				unlimitedWindow: null,
				planGrant: { grantedPlan: 'enterprise' },
				customLimits: null,
				billingAdjustment: null,
			})
			expect(await service.hasFeature('s', 'free', 'customBranding')).toBe(true)
		})
	})

	describe('getLimits', () => {
		it('should return free plan limits', () => {
			const limits = service.getLimits('free')
			expect(limits.unlimited).toBe(false)
			expect(limits.maxProducts).toBeGreaterThan(0)
		})

		it('should return pro plan with finite numeric limits (not unlimited)', () => {
			const limits = service.getLimits('pro')
			expect(limits.unlimited).toBe(false)
			expect(limits.maxProducts).toBeGreaterThan(0)
		})

		it('should return enterprise plan with unlimited flag', () => {
			const limits = service.getLimits('enterprise')
			expect(limits.unlimited).toBe(true)
		})

		it('should fall back to free limits for unknown plan', () => {
			const limits = service.getLimits('unknown_plan')
			expect(limits).toEqual(service.getLimits('free'))
		})
	})

	describe('getUsageStats', () => {
		it('should return counts from repository', async () => {
			repositoryMock.countProducts.mockResolvedValueOnce(10)
			repositoryMock.countCustomers.mockResolvedValueOnce(20)
			repositoryMock.countOrdersThisMonth.mockResolvedValueOnce(5)

			const result = await service.getUsageStats('seller-1')

			expect(result.products).toBe(10)
			expect(result.customers).toBe(20)
			expect(result.ordersThisMonth).toBe(5)
			expect(repositoryMock.countProducts).toHaveBeenCalledWith('seller-1')
		})
	})

	describe('canCreateProduct', () => {
		it('should allow creation when under limit', async () => {
			// Free plan has 50 max products
			repositoryMock.countProducts.mockResolvedValueOnce(10)

			const result = await service.canCreateProduct('seller-1', 'free')

			expect(result.allowed).toBe(true)
			expect(result.current).toBe(10)
		})

		it('should deny creation when at or over the limit', async () => {
			repositoryMock.countProducts.mockResolvedValueOnce(50)

			const result = await service.canCreateProduct('seller-1', 'free')

			expect(result.allowed).toBe(false)
			expect(result.message).toBeTruthy()
		})

		it('should allow creation for pro plan when under its numeric limit', async () => {
			repositoryMock.countProducts.mockResolvedValueOnce(100)

			const result = await service.canCreateProduct('seller-1', 'pro')

			expect(result.allowed).toBe(true)
			expect(result.current).toBe(100)
			expect(repositoryMock.countProducts).toHaveBeenCalledWith('seller-1')
		})

		it('should deny creation for pro plan when at its numeric limit', async () => {
			// Pro plan has 500 max products
			repositoryMock.countProducts.mockResolvedValueOnce(500)

			const result = await service.canCreateProduct('seller-1', 'pro')

			expect(result.allowed).toBe(false)
		})

		it('should allow creation for enterprise plan without counting', async () => {
			const result = await service.canCreateProduct('seller-1', 'enterprise')

			expect(result.allowed).toBe(true)
			expect(repositoryMock.countProducts).not.toHaveBeenCalled()
		})
	})

	describe('canCreateCustomer', () => {
		it('should allow creation when under limit', async () => {
			repositoryMock.countCustomers.mockResolvedValueOnce(5)

			const result = await service.canCreateCustomer('seller-1', 'free')

			expect(result.allowed).toBe(true)
		})

		it('should deny creation when at limit', async () => {
			// Free plan has 100 max customers
			repositoryMock.countCustomers.mockResolvedValueOnce(100)

			const result = await service.canCreateCustomer('seller-1', 'free')

			expect(result.allowed).toBe(false)
		})

		it('should allow creation for enterprise plan without counting', async () => {
			const result = await service.canCreateCustomer('seller-1', 'enterprise')

			expect(result.allowed).toBe(true)
			expect(repositoryMock.countCustomers).not.toHaveBeenCalled()
		})
	})

	describe('canCreateOrder', () => {
		it('should allow when under monthly order limit', async () => {
			repositoryMock.countOrdersThisMonth.mockResolvedValueOnce(5)

			const result = await service.canCreateOrder('seller-1', 'free')

			expect(result.allowed).toBe(true)
		})

		it('should deny when at monthly order limit', async () => {
			// Free plan has 30 max orders per month
			repositoryMock.countOrdersThisMonth.mockResolvedValueOnce(30)

			const result = await service.canCreateOrder('seller-1', 'free')

			expect(result.allowed).toBe(false)
		})
	})

	describe('getUsageSummary', () => {
		it('should return plan, limits, usage, and remaining counts', async () => {
			repositoryMock.countProducts.mockResolvedValueOnce(10)
			repositoryMock.countCustomers.mockResolvedValueOnce(20)
			repositoryMock.countOrdersThisMonth.mockResolvedValueOnce(5)

			const result = await service.getUsageSummary('seller-1', 'free')

			expect(result.plan).toBe('free')
			expect(result.usage.products).toBe(10)
			expect(result.remaining.products).toBeGreaterThanOrEqual(0)
			expect(typeof result.limits.products).toBe('number')
			expect(result.unlimited).toBe(false)
		})

		it('should return -1 for remaining when plan is unlimited', async () => {
			repositoryMock.countProducts.mockResolvedValueOnce(500)
			repositoryMock.countCustomers.mockResolvedValueOnce(1000)
			repositoryMock.countOrdersThisMonth.mockResolvedValueOnce(300)

			// enterprise is the only plan with maxProducts === -1 (truly unlimited)
			const result = await service.getUsageSummary('seller-1', 'enterprise')

			expect(result.remaining.products).toBe(-1)
			expect(result.remaining.customers).toBe(-1)
			expect(result.unlimited).toBe(true)
		})

		it('should expose activeWindow when unlimited period is active for free seller', async () => {
			settingsServiceMock.getUnlimitedPeriodWindow.mockResolvedValueOnce({
				startDate: new Date('2026-01-01'),
				endDate: new Date('2026-12-31'),
				isActive: true,
			})
			repositoryMock.countProducts.mockResolvedValueOnce(75)
			repositoryMock.countCustomers.mockResolvedValueOnce(200)
			repositoryMock.countOrdersThisMonth.mockResolvedValueOnce(40)

			const result = await service.getUsageSummary('seller-1', 'free', new Date('2026-03-15'))

			expect(result.activeWindow?.type).toBe('unlimited_period')
			expect(result.unlimited).toBe(true)
			expect(result.remaining.products).toBe(-1)
			expect(result.activeWindow?.effectiveStart).toEqual(new Date('2026-03-15'))
		})
	})

	describe('Window 1 (unlimited period)', () => {
		it('should bypass product limit for free seller during window', async () => {
			settingsServiceMock.getUnlimitedPeriodWindow.mockResolvedValueOnce({
				startDate: null,
				endDate: new Date(Date.now() + 86400000),
				isActive: true,
			})
			repositoryMock.countProducts.mockResolvedValueOnce(999)

			const result = await service.canCreateProduct('seller-1', 'free')

			expect(result.allowed).toBe(true)
			expect(result.unlimitedReason).toBe('unlimited_period')
		})

		it('should bypass customer limit for free seller during window', async () => {
			settingsServiceMock.getUnlimitedPeriodWindow.mockResolvedValueOnce({
				startDate: null,
				endDate: new Date(Date.now() + 86400000),
				isActive: true,
			})
			repositoryMock.countCustomers.mockResolvedValueOnce(999)

			const result = await service.canCreateCustomer('seller-1', 'free')

			expect(result.allowed).toBe(true)
			expect(result.unlimitedReason).toBe('unlimited_period')
		})

		it('should bypass order limit for free seller during window', async () => {
			settingsServiceMock.getUnlimitedPeriodWindow.mockResolvedValueOnce({
				startDate: null,
				endDate: new Date(Date.now() + 86400000),
				isActive: true,
			})
			repositoryMock.countOrdersThisMonth.mockResolvedValueOnce(999)

			const result = await service.canCreateOrder('seller-1', 'free')

			expect(result.allowed).toBe(true)
			expect(result.unlimitedReason).toBe('unlimited_period')
		})

		it('should not bypass for non-free plans during window', async () => {
			repositoryMock.countProducts.mockResolvedValueOnce(500)

			const result = await service.canCreateProduct('seller-1', 'pro')

			expect(result.allowed).toBe(false)
		})
	})

	describe('isProEffective', () => {
		it('should return true for pro/enterprise', async () => {
			expect(await service.isProEffective('pro')).toBe(true)
			expect(await service.isProEffective('enterprise')).toBe(true)
		})

		it('should return true for free during unlimited window', async () => {
			settingsServiceMock.getUnlimitedPeriodWindow.mockResolvedValueOnce({
				startDate: null,
				endDate: new Date(Date.now() + 86400000),
				isActive: true,
			})

			expect(await service.isProEffective('free')).toBe(true)
		})

		it('should return false for free outside window', async () => {
			expect(await service.isProEffective('free')).toBe(false)
		})
	})

	describe('Account Exception integration (Phase 3)', () => {
		it('should bypass with admin_unlimited_window when unlimited_window exception is active', async () => {
			exceptionServiceMock.resolveActiveExceptions.mockResolvedValueOnce({
				unlimitedWindow: { id: 'ex-1' },
				planGrant: null,
				customLimits: null,
				billingAdjustment: null,
			})
			repositoryMock.countProducts.mockResolvedValueOnce(9999)

			const result = await service.canCreateProduct('seller-1', 'free')

			expect(result.allowed).toBe(true)
			expect(result.unlimitedReason).toBe('admin_unlimited_window')
		})

		it('should treat free seller as pro under plan_grant', async () => {
			exceptionServiceMock.resolveActiveExceptions.mockResolvedValueOnce({
				unlimitedWindow: null,
				planGrant: { record: { id: 'ex-2' }, grantedPlan: 'pro' },
				customLimits: null,
				billingAdjustment: null,
			})
			repositoryMock.countProducts.mockResolvedValueOnce(100)

			const result = await service.canCreateProduct('seller-1', 'free')

			expect(result.allowed).toBe(true)
		})

		it('should apply custom_limits override on products', async () => {
			exceptionServiceMock.resolveActiveExceptions.mockResolvedValueOnce({
				unlimitedWindow: null,
				planGrant: null,
				customLimits: { record: { id: 'ex-3' }, maxProducts: 75 },
				billingAdjustment: null,
			})
			repositoryMock.countProducts.mockResolvedValueOnce(74)

			const result = await service.canCreateProduct('seller-1', 'free')

			expect(result.allowed).toBe(true)
			expect(result.limit).toBe(75)
		})

		it('should deny when custom_limits override is reached', async () => {
			exceptionServiceMock.resolveActiveExceptions.mockResolvedValueOnce({
				unlimitedWindow: null,
				planGrant: null,
				customLimits: { record: { id: 'ex-4' }, maxProducts: 10 },
				billingAdjustment: null,
			})
			repositoryMock.countProducts.mockResolvedValueOnce(10)

			const result = await service.canCreateProduct('seller-1', 'free')

			expect(result.allowed).toBe(false)
			expect(result.limit).toBe(10)
		})

		it('should prefer unlimited_window over plan_grant', async () => {
			exceptionServiceMock.resolveActiveExceptions.mockResolvedValueOnce({
				unlimitedWindow: { id: 'ex-1' },
				planGrant: { record: { id: 'ex-2' }, grantedPlan: 'pro' },
				customLimits: null,
				billingAdjustment: null,
			})
			repositoryMock.countProducts.mockResolvedValueOnce(5000)

			const result = await service.canCreateProduct('seller-1', 'free')

			expect(result.allowed).toBe(true)
			expect(result.unlimitedReason).toBe('admin_unlimited_window')
		})
	})
})
