import { Inject, Injectable } from '@nestjs/common'
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
		unlimited: true,
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
}

@Injectable()
export class PlanLimitsService {
	constructor(
		@Inject(PLAN_LIMITS_REPOSITORY)
		private readonly planLimitsRepository: PlanLimitsRepository,
		private readonly settingsService: SettingsService,
	) {}

	getLimits(planType: string): PlanLimits {
		return PLAN_LIMITS[planType] || PLAN_LIMITS.free
	}

	private async getFreeLimitsWithOverrides(): Promise<{
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
		const limits = this.getLimits(planType)

		if (limits.unlimited || limits.maxProducts === -1) {
			return { allowed: true, current: 0, limit: -1 }
		}

		const maxProducts =
			planType === 'free'
				? (await this.getFreeLimitsWithOverrides()).maxProducts
				: limits.maxProducts

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
		const limits = this.getLimits(planType)

		if (limits.unlimited || limits.maxCustomers === -1) {
			return { allowed: true, current: 0, limit: -1 }
		}

		const maxCustomers =
			planType === 'free'
				? (await this.getFreeLimitsWithOverrides()).maxCustomers
				: limits.maxCustomers

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
		const limits = this.getLimits(planType)

		if (limits.unlimited || limits.maxOrdersPerMonth === -1) {
			return { allowed: true, current: 0, limit: -1 }
		}

		const maxOrdersPerMonth =
			planType === 'free'
				? (await this.getFreeLimitsWithOverrides()).maxOrdersPerMonth
				: limits.maxOrdersPerMonth

		const startOfMonth = new Date()
		startOfMonth.setDate(1)
		startOfMonth.setHours(0, 0, 0, 0)

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

	async getUsageSummary(sellerId: string, planType: string) {
		const limits = this.getLimits(planType)
		const usage = await this.getUsageStats(sellerId)

		return {
			plan: planType,
			limits: {
				products: limits.maxProducts,
				customers: limits.maxCustomers,
				ordersPerMonth: limits.maxOrdersPerMonth,
			},
			usage: {
				products: usage.products,
				customers: usage.customers,
				ordersThisMonth: usage.ordersThisMonth,
			},
			remaining: {
				products: limits.maxProducts === -1 ? -1 : Math.max(0, limits.maxProducts - usage.products),
				customers:
					limits.maxCustomers === -1 ? -1 : Math.max(0, limits.maxCustomers - usage.customers),
				ordersThisMonth:
					limits.maxOrdersPerMonth === -1
						? -1
						: Math.max(0, limits.maxOrdersPerMonth - usage.ordersThisMonth),
			},
			unlimited: limits.unlimited,
		}
	}
}
