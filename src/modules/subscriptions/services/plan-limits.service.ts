import { Injectable } from '@nestjs/common'
import { PrismaService } from '@/shared/prisma/prisma.service'

export interface PlanLimits {
	maxProducts: number
	maxCustomers: number
	maxOrdersPerMonth: number
	unlimited: boolean
}

export const PLAN_LIMITS: Record<string, PlanLimits> = {
	free: {
		maxProducts: 60,
		maxCustomers: 40,
		maxOrdersPerMonth: 30,
		unlimited: false,
	},
	pro: {
		maxProducts: -1, // unlimited
		maxCustomers: -1,
		maxOrdersPerMonth: -1,
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
	constructor(private readonly prisma: PrismaService) {}

	getLimits(planType: string): PlanLimits {
		return PLAN_LIMITS[planType] || PLAN_LIMITS.free
	}

	async getUsageStats(sellerId: string): Promise<UsageStats> {
		const startOfMonth = new Date()
		startOfMonth.setDate(1)
		startOfMonth.setHours(0, 0, 0, 0)

		const [products, customers, ordersThisMonth] = await Promise.all([
			this.prisma.product.count({ where: { seller_id: sellerId } }),
			this.prisma.customer.count({ where: { seller_id: sellerId } }),
			this.prisma.order.count({
				where: {
					seller_id: sellerId,
					createdAt: { gte: startOfMonth },
				},
			}),
		])

		return { products, customers, ordersThisMonth }
	}

	async canCreateProduct(sellerId: string, planType: string): Promise<LimitCheckResult> {
		const limits = this.getLimits(planType)

		if (limits.unlimited || limits.maxProducts === -1) {
			return { allowed: true, current: 0, limit: -1 }
		}

		const count = await this.prisma.product.count({ where: { seller_id: sellerId } })

		if (count >= limits.maxProducts) {
			return {
				allowed: false,
				message: `Limite de produtos atingido (${limits.maxProducts}). Faça upgrade para o plano Pro.`,
				current: count,
				limit: limits.maxProducts,
			}
		}

		return { allowed: true, current: count, limit: limits.maxProducts }
	}

	async canCreateCustomer(sellerId: string, planType: string): Promise<LimitCheckResult> {
		const limits = this.getLimits(planType)

		if (limits.unlimited || limits.maxCustomers === -1) {
			return { allowed: true, current: 0, limit: -1 }
		}

		const count = await this.prisma.customer.count({ where: { seller_id: sellerId } })

		if (count >= limits.maxCustomers) {
			return {
				allowed: false,
				message: `Limite de clientes atingido (${limits.maxCustomers}). Faça upgrade para o plano Pro.`,
				current: count,
				limit: limits.maxCustomers,
			}
		}

		return { allowed: true, current: count, limit: limits.maxCustomers }
	}

	async canCreateOrder(sellerId: string, planType: string): Promise<LimitCheckResult> {
		const limits = this.getLimits(planType)

		if (limits.unlimited || limits.maxOrdersPerMonth === -1) {
			return { allowed: true, current: 0, limit: -1 }
		}

		const startOfMonth = new Date()
		startOfMonth.setDate(1)
		startOfMonth.setHours(0, 0, 0, 0)

		const count = await this.prisma.order.count({
			where: {
				seller_id: sellerId,
				createdAt: { gte: startOfMonth },
			},
		})

		if (count >= limits.maxOrdersPerMonth) {
			return {
				allowed: false,
				message: `Limite de vendas do mês atingido (${limits.maxOrdersPerMonth}). Faça upgrade para o plano Pro.`,
				current: count,
				limit: limits.maxOrdersPerMonth,
			}
		}

		return { allowed: true, current: count, limit: limits.maxOrdersPerMonth }
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
				customers: limits.maxCustomers === -1 ? -1 : Math.max(0, limits.maxCustomers - usage.customers),
				ordersThisMonth: limits.maxOrdersPerMonth === -1 ? -1 : Math.max(0, limits.maxOrdersPerMonth - usage.ordersThisMonth),
			},
			unlimited: limits.unlimited,
		}
	}
}
