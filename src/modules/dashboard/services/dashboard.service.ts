import { Injectable } from '@nestjs/common'
import { PrismaService } from '@/shared/prisma/prisma.service'
import { TenantContext } from '@/shared/tenant/tenant.context'

@Injectable()
export class DashboardService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly tenantContext: TenantContext,
	) {}

	private getTenantFilter() {
		if (this.tenantContext.isAdmin()) {
			return {}
		}
		return { seller_id: this.tenantContext.requireSellerId() }
	}

	async getStats(_accountId: string) {
		const tenantFilter = this.getTenantFilter()
		const [
			totalProducts,
			totalCustomers,
			totalOrders,
			pendingOrders,
			recentOrders,
			topProducts,
		] = await Promise.all([
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

		const topProductsWithDetails = await Promise.all(
			topProducts.map(async (item) => {
				const product = await this.prisma.product.findUnique({
					where: { id: item.product_id },
					select: { name: true },
				})
				return {
					name: product?.name || 'Produto removido',
					sales: item._sum.quantity || 0,
				}
			}),
		)

		const totalRevenue = await this.prisma.order.aggregate({
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
			totalRevenue: totalRevenue._sum?.total || 0,
			recentOrders: recentOrders.map((order) => ({
				id: order.id,
				orderNumber: order.order_number,
				customer: order.customer?.name || 'Cliente removido',
				total: order.total,
				status: order.status,
				createdAt: order.createdAt,
			})),
			topProducts: topProductsWithDetails,
		}
	}
}
