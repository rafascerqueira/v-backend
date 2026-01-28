import { Injectable } from '@nestjs/common'
import type { PrismaService } from '@/shared/prisma/prisma.service'
import type { TenantContext } from '@/shared/tenant/tenant.context'

type Period = 'week' | 'month' | 'year'

@Injectable()
export class ReportsService {
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

	private getDateRange(period: Period): { start: Date; end: Date } {
		const end = new Date()
		const start = new Date()

		switch (period) {
			case 'week':
				start.setDate(start.getDate() - 7)
				break
			case 'month':
				start.setMonth(start.getMonth() - 1)
				break
			case 'year':
				start.setFullYear(start.getFullYear() - 1)
				break
		}

		return { start, end }
	}

	private getPreviousDateRange(period: Period): { start: Date; end: Date } {
		const { start: currentStart, end: currentEnd } = this.getDateRange(period)
		const duration = currentEnd.getTime() - currentStart.getTime()

		return {
			start: new Date(currentStart.getTime() - duration),
			end: new Date(currentStart.getTime() - 1),
		}
	}

	async getFullReport(period: Period = 'month') {
		const tenantFilter = this.getTenantFilter()
		const { start, end } = this.getDateRange(period)
		const { start: prevStart, end: prevEnd } = this.getPreviousDateRange(period)

		const [currentOrders, previousOrders] = await Promise.all([
			this.prisma.order.findMany({
				where: {
					...tenantFilter,
					createdAt: { gte: start, lte: end },
				},
				include: {
					customer: { select: { name: true } },
					Order_item: { include: { product: { select: { category: true } } } },
				},
				orderBy: { createdAt: 'desc' },
			}),
			this.prisma.order.findMany({
				where: {
					...tenantFilter,
					createdAt: { gte: prevStart, lte: prevEnd },
				},
			}),
		])

		const currentRevenue = currentOrders.reduce((acc, o) => acc + o.total, 0)
		const previousRevenue = previousOrders.reduce((acc, o) => acc + o.total, 0)
		const revenueChange =
			previousRevenue > 0 ? ((currentRevenue - previousRevenue) / previousRevenue) * 100 : 0

		const currentOrderCount = currentOrders.length
		const previousOrderCount = previousOrders.length
		const ordersChange =
			previousOrderCount > 0
				? ((currentOrderCount - previousOrderCount) / previousOrderCount) * 100
				: 0

		const currentAvgTicket = currentOrderCount > 0 ? currentRevenue / currentOrderCount : 0
		const previousAvgTicket = previousOrderCount > 0 ? previousRevenue / previousOrderCount : 0
		const avgTicketChange =
			previousAvgTicket > 0 ? ((currentAvgTicket - previousAvgTicket) / previousAvgTicket) * 100 : 0

		const salesByMonth = this.aggregateSalesByPeriod(currentOrders, period)
		const categoryData = this.aggregateSalesByCategory(currentOrders)
		const weeklyData = this.aggregateOrdersByDayOfWeek(currentOrders)
		const topProducts = await this.getTopProducts(tenantFilter, start, end)

		return {
			summary: {
				totalRevenue: currentRevenue,
				revenueChange: Math.round(revenueChange * 10) / 10,
				totalOrders: currentOrderCount,
				ordersChange: Math.round(ordersChange * 10) / 10,
				avgTicket: currentAvgTicket,
				avgTicketChange: Math.round(avgTicketChange * 10) / 10,
				conversionRate: 0,
				conversionChange: 0,
			},
			salesData: salesByMonth,
			categoryData,
			weeklyData,
			topProducts,
			period: { start, end },
		}
	}

	private aggregateSalesByPeriod(
		orders: Array<{ createdAt: Date; total: number }>,
		period: Period,
	) {
		const monthNames = [
			'Jan',
			'Fev',
			'Mar',
			'Abr',
			'Mai',
			'Jun',
			'Jul',
			'Ago',
			'Set',
			'Out',
			'Nov',
			'Dez',
		]
		const data: Record<string, { vendas: number; meta: number }> = {}

		for (const order of orders) {
			let key: string
			if (period === 'year') {
				key = monthNames[order.createdAt.getMonth()]
			} else {
				key = order.createdAt.toISOString().split('T')[0]
			}

			if (!data[key]) {
				data[key] = { vendas: 0, meta: 0 }
			}
			data[key].vendas += order.total
		}

		return Object.entries(data)
			.map(([key, value]) => ({
				month: key,
				vendas: value.vendas,
				meta: value.vendas * 1.1,
			}))
			.slice(-12)
	}

	private aggregateSalesByCategory(
		orders: Array<{
			Order_item: Array<{
				total: number
				product: { category: string | null } | null
			}>
		}>,
	) {
		const colors = ['#6366f1', '#8b5cf6', '#a855f7', '#d946ef', '#ec4899', '#f43f5e']
		const categoryTotals: Record<string, number> = {}
		let totalValue = 0

		for (const order of orders) {
			for (const item of order.Order_item) {
				const category = item.product?.category || 'Outros'
				categoryTotals[category] = (categoryTotals[category] || 0) + item.total
				totalValue += item.total
			}
		}

		return Object.entries(categoryTotals)
			.map(([name, value], index) => ({
				name,
				value: totalValue > 0 ? Math.round((value / totalValue) * 100) : 0,
				color: colors[index % colors.length],
			}))
			.sort((a, b) => b.value - a.value)
			.slice(0, 6)
	}

	private aggregateOrdersByDayOfWeek(orders: Array<{ createdAt: Date }>) {
		const dayNames = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
		const dayCounts: Record<string, number> = {}

		for (const day of dayNames) {
			dayCounts[day] = 0
		}

		for (const order of orders) {
			const dayIndex = order.createdAt.getDay()
			const dayName = dayNames[dayIndex]
			dayCounts[dayName]++
		}

		return [
			{ day: 'Seg', pedidos: dayCounts['Seg'] },
			{ day: 'Ter', pedidos: dayCounts['Ter'] },
			{ day: 'Qua', pedidos: dayCounts['Qua'] },
			{ day: 'Qui', pedidos: dayCounts['Qui'] },
			{ day: 'Sex', pedidos: dayCounts['Sex'] },
			{ day: 'Sáb', pedidos: dayCounts['Sáb'] },
			{ day: 'Dom', pedidos: dayCounts['Dom'] },
		]
	}

	private async getTopProducts(
		tenantFilter: Record<string, string | undefined>,
		start: Date,
		end: Date,
		limit = 5,
	) {
		const orders = await this.prisma.order.findMany({
			where: {
				...tenantFilter,
				createdAt: { gte: start, lte: end },
			},
			include: {
				Order_item: {
					include: { product: { select: { id: true, name: true } } },
				},
			},
		})

		const productStats: Record<string, { name: string; vendas: number; receita: number }> = {}

		for (const order of orders) {
			for (const item of order.Order_item) {
				const productId = item.product_id
				const productName = item.product?.name || 'Produto removido'

				if (!productStats[productId]) {
					productStats[productId] = {
						name: productName,
						vendas: 0,
						receita: 0,
					}
				}

				productStats[productId].vendas += item.quantity
				productStats[productId].receita += item.total
			}
		}

		return Object.values(productStats)
			.sort((a, b) => b.vendas - a.vendas)
			.slice(0, limit)
	}

	async getSalesReport(startDate?: string, endDate?: string) {
		const tenantFilter = this.getTenantFilter()
		const start = startDate
			? new Date(startDate)
			: new Date(new Date().setMonth(new Date().getMonth() - 1))
		const end = endDate ? new Date(endDate) : new Date()

		const orders = await this.prisma.order.findMany({
			where: {
				...tenantFilter,
				createdAt: { gte: start, lte: end },
			},
			include: {
				customer: { select: { name: true } },
				Order_item: true,
			},
			orderBy: { createdAt: 'desc' },
		})

		const totalSales = orders.reduce((acc, o) => acc + o.total, 0)
		const totalOrders = orders.length
		const avgOrderValue = totalOrders > 0 ? totalSales / totalOrders : 0

		const salesByDay = orders.reduce(
			(acc, order) => {
				const day = order.createdAt.toISOString().split('T')[0]
				acc[day] = (acc[day] || 0) + order.total
				return acc
			},
			{} as Record<string, number>,
		)

		const salesByStatus = orders.reduce(
			(acc, order) => {
				acc[order.status] = (acc[order.status] || 0) + 1
				return acc
			},
			{} as Record<string, number>,
		)

		return {
			summary: {
				totalSales,
				totalOrders,
				avgOrderValue,
				period: { start, end },
			},
			salesByDay: Object.entries(salesByDay).map(([date, value]) => ({
				date,
				value,
			})),
			salesByStatus,
			recentOrders: orders.slice(0, 10).map((o) => ({
				id: o.id,
				order_number: o.order_number,
				customer: o.customer?.name,
				total: o.total,
				status: o.status,
				date: o.createdAt,
			})),
		}
	}

	async getProductsReport(limit = 10) {
		const tenantFilter = this.getTenantFilter()

		const orders = await this.prisma.order.findMany({
			where: tenantFilter,
			include: {
				Order_item: {
					include: {
						product: {
							select: { id: true, name: true, sku: true, category: true },
						},
					},
				},
			},
		})

		const productStats: Record<
			string,
			{
				product: {
					id: number
					name: string
				}
				quantitySold: number
				totalRevenue: number
				orderCount: number
			}
		> = {}

		const categoryTotals: Record<string, number> = {}

		for (const order of orders) {
			for (const item of order.Order_item) {
				const productId = item.product_id

				if (!productStats[productId]) {
					productStats[productId] = {
						product: item.product || {
							id: productId,
							name: 'Removido',
						},
						quantitySold: 0,
						totalRevenue: 0,
						orderCount: 0,
					}
				}

				productStats[productId].quantitySold += item.quantity
				productStats[productId].totalRevenue += item.total
				productStats[productId].orderCount++

				const category = item.product?.category || 'Outros'
				categoryTotals[category] = (categoryTotals[category] || 0) + item.total
			}
		}

		return {
			topProducts: Object.values(productStats)
				.sort((a, b) => b.quantitySold - a.quantitySold)
				.slice(0, limit),
			salesByCategory: Object.entries(categoryTotals)
				.map(([category, value]) => ({ category, value }))
				.sort((a, b) => b.value - a.value),
		}
	}

	async getCustomersReport(limit = 10) {
		const tenantFilter = this.getTenantFilter()

		const customerOrders = await this.prisma.order.groupBy({
			by: ['customer_id'],
			where: tenantFilter,
			_sum: { total: true },
			_count: { id: true },
			orderBy: { _sum: { total: 'desc' } },
			take: limit,
		})

		const customerIds = customerOrders.map((c) => c.customer_id)
		const customers = await this.prisma.customer.findMany({
			where: { id: { in: customerIds } },
			select: { id: true, name: true, email: true, city: true, state: true },
		})

		const customerMap = new Map(customers.map((c) => [c.id, c]))

		const topCustomers = customerOrders.map((item) => ({
			customer: customerMap.get(item.customer_id),
			totalSpent: item._sum.total || 0,
			orderCount: item._count.id,
			avgOrderValue: (item._sum.total || 0) / item._count.id,
		}))

		const totalCustomers = await this.prisma.customer.count({
			where: tenantFilter,
		})
		const activeCustomers = await this.prisma.customer.count({
			where: { ...tenantFilter, active: true },
		})
		const customersWithOrders = customerOrders.length

		return {
			topCustomers,
			summary: {
				totalCustomers,
				activeCustomers,
				customersWithOrders,
				conversionRate: totalCustomers > 0 ? (customersWithOrders / totalCustomers) * 100 : 0,
			},
		}
	}
}
