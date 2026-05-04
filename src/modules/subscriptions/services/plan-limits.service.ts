import { Inject, Injectable } from '@nestjs/common'
import { AccountExceptionService } from '@/modules/account-exceptions/services/account-exception.service'
import { SettingsService } from '@/modules/admin/services/settings.service'
import {
	PLAN_LIMITS_REPOSITORY,
	type PlanLimitsRepository,
} from '@/shared/repositories/plan-limits.repository'
import { PLAN_LIMITS as CANONICAL_LIMITS } from '../constants/plan-limits'

export interface PlanLimits {
	maxProducts: number
	maxCustomers: number
	maxOrdersPerMonth: number
	unlimited: boolean
}

export const PLAN_LIMITS: Record<string, PlanLimits> = {
	free: {
		maxProducts: CANONICAL_LIMITS.free.maxProducts,
		maxCustomers: CANONICAL_LIMITS.free.maxCustomers,
		maxOrdersPerMonth: CANONICAL_LIMITS.free.maxOrdersPerMonth,
		unlimited: false,
	},
	pro: {
		maxProducts: CANONICAL_LIMITS.pro.maxProducts,
		maxCustomers: CANONICAL_LIMITS.pro.maxCustomers,
		maxOrdersPerMonth: CANONICAL_LIMITS.pro.maxOrdersPerMonth,
		unlimited: false,
	},
	enterprise: {
		maxProducts: CANONICAL_LIMITS.enterprise.maxProducts,
		maxCustomers: CANONICAL_LIMITS.enterprise.maxCustomers,
		maxOrdersPerMonth: CANONICAL_LIMITS.enterprise.maxOrdersPerMonth,
		unlimited: true,
	},
}

export interface UsageStats {
	products: number
	customers: number
	ordersThisMonth: number
}

export interface LimitCheckResult {
	allowed: boolean
	message?: string
	current: number
	limit: number
	unlimitedReason?: 'unlimited_period' | 'admin_grant' | 'admin_unlimited_window'
}

@Injectable()
export class PlanLimitsService {
	constructor(
		@Inject(PLAN_LIMITS_REPOSITORY)
		private readonly planLimitsRepository: PlanLimitsRepository,
		private readonly settingsService: SettingsService,
		private readonly exceptionService: AccountExceptionService,
	) {}

	private async resolveEffectivePlan(
		sellerId: string,
		planType: string,
	): Promise<{
		effectivePlan: string
		unlimitedFromException: boolean
		customLimits: { maxProducts?: number; maxCustomers?: number; maxOrdersPerMonth?: number } | null
	}> {
		const exceptions = await this.exceptionService.resolveActiveExceptions(sellerId)

		if (exceptions.unlimitedWindow) {
			return { effectivePlan: planType, unlimitedFromException: true, customLimits: null }
		}

		const effectivePlan = exceptions.planGrant?.grantedPlan ?? planType
		const customLimits = exceptions.customLimits
			? {
					maxProducts: exceptions.customLimits.maxProducts,
					maxCustomers: exceptions.customLimits.maxCustomers,
					maxOrdersPerMonth: exceptions.customLimits.maxOrdersPerMonth,
				}
			: null

		return { effectivePlan, unlimitedFromException: false, customLimits }
	}

	getLimits(planType: string): PlanLimits {
		return PLAN_LIMITS[planType] || PLAN_LIMITS.free
	}

	private async getFreePeriodLimitsWithOverrides(): Promise<{
		maxProducts: number
		maxCustomers: number
		maxOrdersPerMonth: number
	}> {
		const [products, customers, orders] = await Promise.all([
			this.settingsService.get('free_plan_products_limit'),
			this.settingsService.get('free_plan_customers_limit'),
			this.settingsService.get('free_plan_sales_limit'),
		])
		return {
			maxProducts: products ? (products.parsed as number) : CANONICAL_LIMITS.free.maxProducts,
			maxCustomers: customers ? (customers.parsed as number) : CANONICAL_LIMITS.free.maxCustomers,
			maxOrdersPerMonth: orders
				? (orders.parsed as number)
				: CANONICAL_LIMITS.free.maxOrdersPerMonth,
		}
	}

	async isUnlimitedPeriodActive(): Promise<boolean> {
		const window = await this.settingsService.getUnlimitedPeriodWindow()
		return window.isActive
	}

	async isProEffective(planType: string): Promise<boolean> {
		if (planType === 'pro' || planType === 'enterprise') return true
		if (planType === 'free') {
			return this.isUnlimitedPeriodActive()
		}
		return false
	}

	async getUsageStats(sellerId: string): Promise<UsageStats> {
		const startOfMonth = new Date()
		startOfMonth.setDate(1)
		startOfMonth.setHours(0, 0, 0, 0)

		const [products, customers, ordersThisMonth] = await Promise.all([
			this.planLimitsRepository.countProducts(sellerId),
			this.planLimitsRepository.countCustomers(sellerId),
			this.planLimitsRepository.countOrdersThisMonth(sellerId, startOfMonth),
		])

		return { products, customers, ordersThisMonth }
	}

	async canCreateProduct(sellerId: string, planType: string): Promise<LimitCheckResult> {
		const resolved = await this.resolveEffectivePlan(sellerId, planType)

		if (resolved.unlimitedFromException) {
			const count = await this.planLimitsRepository.countProducts(sellerId)
			return {
				allowed: true,
				current: count,
				limit: -1,
				unlimitedReason: 'admin_unlimited_window',
			}
		}

		const limits = this.getLimits(resolved.effectivePlan)

		if (limits.unlimited || limits.maxProducts === -1) {
			return {
				allowed: true,
				current: 0,
				limit: -1,
				...(resolved.effectivePlan !== planType ? { unlimitedReason: 'admin_grant' } : {}),
			}
		}

		if (resolved.effectivePlan === 'free' && (await this.isUnlimitedPeriodActive())) {
			const count = await this.planLimitsRepository.countProducts(sellerId)
			return {
				allowed: true,
				current: count,
				limit: -1,
				unlimitedReason: 'unlimited_period',
			}
		}

		let maxProducts =
			resolved.effectivePlan === 'free'
				? (await this.getFreePeriodLimitsWithOverrides()).maxProducts
				: limits.maxProducts

		if (resolved.customLimits?.maxProducts !== undefined) {
			maxProducts = resolved.customLimits.maxProducts
		}

		const count = await this.planLimitsRepository.countProducts(sellerId)

		if (count >= maxProducts) {
			return {
				allowed: false,
				message: `Limite de produtos atingido (${maxProducts}). Faça upgrade para o plano Pro.`,
				current: count,
				limit: maxProducts,
			}
		}

		return { allowed: true, current: count, limit: maxProducts }
	}

	async canCreateCustomer(sellerId: string, planType: string): Promise<LimitCheckResult> {
		const resolved = await this.resolveEffectivePlan(sellerId, planType)

		if (resolved.unlimitedFromException) {
			const count = await this.planLimitsRepository.countCustomers(sellerId)
			return {
				allowed: true,
				current: count,
				limit: -1,
				unlimitedReason: 'admin_unlimited_window',
			}
		}

		const limits = this.getLimits(resolved.effectivePlan)

		if (limits.unlimited || limits.maxCustomers === -1) {
			return {
				allowed: true,
				current: 0,
				limit: -1,
				...(resolved.effectivePlan !== planType ? { unlimitedReason: 'admin_grant' } : {}),
			}
		}

		if (resolved.effectivePlan === 'free' && (await this.isUnlimitedPeriodActive())) {
			const count = await this.planLimitsRepository.countCustomers(sellerId)
			return {
				allowed: true,
				current: count,
				limit: -1,
				unlimitedReason: 'unlimited_period',
			}
		}

		let maxCustomers =
			resolved.effectivePlan === 'free'
				? (await this.getFreePeriodLimitsWithOverrides()).maxCustomers
				: limits.maxCustomers

		if (resolved.customLimits?.maxCustomers !== undefined) {
			maxCustomers = resolved.customLimits.maxCustomers
		}

		const count = await this.planLimitsRepository.countCustomers(sellerId)

		if (count >= maxCustomers) {
			return {
				allowed: false,
				message: `Limite de clientes atingido (${maxCustomers}). Faça upgrade para o plano Pro.`,
				current: count,
				limit: maxCustomers,
			}
		}

		return { allowed: true, current: count, limit: maxCustomers }
	}

	async canCreateOrder(sellerId: string, planType: string): Promise<LimitCheckResult> {
		const resolved = await this.resolveEffectivePlan(sellerId, planType)

		const startOfMonth = new Date()
		startOfMonth.setDate(1)
		startOfMonth.setHours(0, 0, 0, 0)

		if (resolved.unlimitedFromException) {
			const count = await this.planLimitsRepository.countOrdersThisMonth(sellerId, startOfMonth)
			return {
				allowed: true,
				current: count,
				limit: -1,
				unlimitedReason: 'admin_unlimited_window',
			}
		}

		const limits = this.getLimits(resolved.effectivePlan)

		if (limits.unlimited || limits.maxOrdersPerMonth === -1) {
			return {
				allowed: true,
				current: 0,
				limit: -1,
				...(resolved.effectivePlan !== planType ? { unlimitedReason: 'admin_grant' } : {}),
			}
		}

		if (resolved.effectivePlan === 'free' && (await this.isUnlimitedPeriodActive())) {
			const count = await this.planLimitsRepository.countOrdersThisMonth(sellerId, startOfMonth)
			return {
				allowed: true,
				current: count,
				limit: -1,
				unlimitedReason: 'unlimited_period',
			}
		}

		let maxOrdersPerMonth =
			resolved.effectivePlan === 'free'
				? (await this.getFreePeriodLimitsWithOverrides()).maxOrdersPerMonth
				: limits.maxOrdersPerMonth

		if (resolved.customLimits?.maxOrdersPerMonth !== undefined) {
			maxOrdersPerMonth = resolved.customLimits.maxOrdersPerMonth
		}

		const count = await this.planLimitsRepository.countOrdersThisMonth(sellerId, startOfMonth)

		if (count >= maxOrdersPerMonth) {
			return {
				allowed: false,
				message: `Limite de vendas do mês atingido (${maxOrdersPerMonth}). Faça upgrade para o plano Pro.`,
				current: count,
				limit: maxOrdersPerMonth,
			}
		}

		return { allowed: true, current: count, limit: maxOrdersPerMonth }
	}

	async getUsageSummary(sellerId: string, planType: string, accountCreatedAt?: Date) {
		const resolved = await this.resolveEffectivePlan(sellerId, planType)
		const limits = this.getLimits(resolved.effectivePlan)
		const usage = await this.getUsageStats(sellerId)
		const unlimitedWindow = await this.settingsService.getUnlimitedPeriodWindow()

		const unlimitedActiveForFree = resolved.effectivePlan === 'free' && unlimitedWindow.isActive
		const unlimitedFromException = resolved.unlimitedFromException

		const effectiveLimits =
			unlimitedActiveForFree || unlimitedFromException
				? { products: -1, customers: -1, ordersPerMonth: -1 }
				: {
						products: resolved.customLimits?.maxProducts ?? limits.maxProducts,
						customers: resolved.customLimits?.maxCustomers ?? limits.maxCustomers,
						ordersPerMonth: resolved.customLimits?.maxOrdersPerMonth ?? limits.maxOrdersPerMonth,
					}

		const remaining = {
			products:
				effectiveLimits.products === -1
					? -1
					: Math.max(0, effectiveLimits.products - usage.products),
			customers:
				effectiveLimits.customers === -1
					? -1
					: Math.max(0, effectiveLimits.customers - usage.customers),
			ordersThisMonth:
				effectiveLimits.ordersPerMonth === -1
					? -1
					: Math.max(0, effectiveLimits.ordersPerMonth - usage.ordersThisMonth),
		}

		let activeWindow: {
			type: 'unlimited_period'
			startDate: Date | null
			endDate: Date | null
			effectiveStart: Date | null
		} | null = null

		if (unlimitedActiveForFree) {
			const effectiveStart =
				unlimitedWindow.startDate && accountCreatedAt
					? unlimitedWindow.startDate > accountCreatedAt
						? unlimitedWindow.startDate
						: accountCreatedAt
					: (unlimitedWindow.startDate ?? accountCreatedAt ?? null)

			activeWindow = {
				type: 'unlimited_period',
				startDate: unlimitedWindow.startDate,
				endDate: unlimitedWindow.endDate,
				effectiveStart,
			}
		}

		return {
			plan: planType,
			effectivePlan: resolved.effectivePlan,
			limits: effectiveLimits,
			usage: {
				products: usage.products,
				customers: usage.customers,
				ordersThisMonth: usage.ordersThisMonth,
			},
			remaining,
			unlimited: limits.unlimited || unlimitedActiveForFree || unlimitedFromException,
			activeWindow,
		}
	}
}
