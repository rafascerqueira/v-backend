import { Inject, Injectable } from '@nestjs/common'
import { RedisService } from '@/shared/redis/redis.service'
import {
	DASHBOARD_REPOSITORY,
	type DashboardRepository,
} from '@/shared/repositories/dashboard.repository'
import { TenantContext } from '@/shared/tenant/tenant.context'

const CACHE_TTL_SECONDS = 60

@Injectable()
export class DashboardService {
	constructor(
		@Inject(DASHBOARD_REPOSITORY) private readonly dashboardRepository: DashboardRepository,
		private readonly tenantContext: TenantContext,
		private readonly redis: RedisService,
	) {}

	private getTenantFilter() {
		if (this.tenantContext.isAdmin()) {
			return {}
		}
		return { seller_id: this.tenantContext.requireSellerId() }
	}

	private getCacheKey(accountId: string) {
		return `dashboard:stats:${accountId}`
	}

	async getStats(accountId: string) {
		const cacheKey = this.getCacheKey(accountId)

		const cached = await this.redis.get(cacheKey)
		if (cached) {
			return JSON.parse(cached)
		}

		const tenantFilter = this.getTenantFilter()
		const stats = await this.dashboardRepository.getStats(tenantFilter)

		const topProductsWithDetails = stats.topProducts.map((item) => ({
			name: stats.productNames.get(item.product_id) || 'Produto removido',
			sales: item._sum.quantity || 0,
		}))

		const result = {
			totalProducts: stats.totalProducts,
			totalCustomers: stats.totalCustomers,
			totalOrders: stats.totalOrders,
			pendingOrders: stats.pendingOrders,
			totalRevenue: stats.totalRevenue,
			recentOrders: stats.recentOrders.map((order) => ({
				id: order.id,
				orderNumber: order.order_number,
				customer: order.customer?.name || 'Cliente removido',
				total: order.total,
				status: order.status,
				createdAt: order.createdAt,
			})),
			topProducts: topProductsWithDetails,
		}

		await this.redis.setWithExpiry(cacheKey, JSON.stringify(result), CACHE_TTL_SECONDS)

		return result
	}
}
