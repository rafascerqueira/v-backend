import { Injectable } from '@nestjs/common'
import { PrismaService } from '@/shared/prisma/prisma.service'
import type {
	DashboardRepository,
	DashboardStats,
} from '@/shared/repositories/dashboard.repository'

@Injectable()
export class PrismaDashboardRepository implements DashboardRepository {
	constructor(private readonly prisma: PrismaService) {}

	async getStats(tenantFilter: Record<string, unknown>): Promise<DashboardStats> {
		const [totalProducts, totalCustomers, totalOrders, pendingOrders, recentOrders, topProducts] =
			await Promise.all([
				this.prisma.product.count({
					where: { active: true, deletedAt: null, ...tenantFilter },
				}),
				this.prisma.customer.count({
					where: { active: true, ...tenantFilter },
				}),
				this.prisma.order.count({
					where: tenantFilter,
				}),
				this.prisma.order.count({
					where: { status: 'pending', ...tenantFilter },
				}),
				this.prisma.order.findMany({
					where: tenantFilter,
					take: 5,
					orderBy: { createdAt: 'desc' },
					include: {
						customer: {
							select: {
								name: true,
							},
						},
					},
				}),
				this.prisma.order_item.groupBy({
					by: ['product_id'],
					where: {
						order: tenantFilter,
					},
					_sum: {
						quantity: true,
					},
					orderBy: {
						_sum: {
							quantity: 'desc',
						},
					},
					take: 5,
				}),
			])

		const productIds = topProducts.map((item) => item.product_id)
		const products = await this.prisma.product.findMany({
			where: { id: { in: productIds } },
			select: { id: true, name: true },
		})
		const productNames = new Map(products.map((p) => [p.id, p.name]))

		const totalRevenueResult = await this.prisma.order.aggregate({
			where: {
				status: { in: ['delivered', 'confirmed'] },
				...tenantFilter,
			},
			_sum: {
				total: true,
			},
		})

		return {
			totalProducts,
			totalCustomers,
			totalOrders,
			pendingOrders,
			recentOrders: recentOrders as unknown as DashboardStats['recentOrders'],
			topProducts: topProducts as unknown as DashboardStats['topProducts'],
			totalRevenue: totalRevenueResult._sum?.total || 0,
			productNames,
		}
	}
}
