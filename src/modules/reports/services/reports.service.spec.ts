import { Test } from '@nestjs/testing'
import { REPORTS_REPOSITORY } from '@/shared/repositories/reports.repository'
import { TenantContext } from '@/shared/tenant/tenant.context'
import { ReportsService } from './reports.service'

const repositoryMock = {
	findOrdersWithItems: jest.fn().mockResolvedValue([]),
	findOrdersBasic: jest.fn().mockResolvedValue([]),
	findOrdersForCharts: jest.fn().mockResolvedValue([]),
	aggregateOrders: jest.fn().mockResolvedValue({ _sum: { total: 0 }, _count: 0 }),
	countCustomers: jest.fn().mockResolvedValue(0),
	countAllCustomers: jest.fn().mockResolvedValue(0),
	countActiveCustomers: jest.fn().mockResolvedValue(0),
	groupOrdersByCustomer: jest.fn().mockResolvedValue([]),
	findCustomersByIds: jest.fn().mockResolvedValue([]),
}

const tenantContextMock = {
	isAdmin: jest.fn().mockReturnValue(false),
	requireSellerId: jest.fn().mockReturnValue('seller-1'),
}

function orderWithItems(over: Partial<any> = {}) {
	return {
		id: 1,
		order_number: 'ORD-1',
		total: 1000,
		status: 'delivered',
		createdAt: new Date('2026-06-10T10:00:00Z'),
		customer: { name: 'Alice' },
		Order_item: [
			{
				product_id: 7,
				quantity: 2,
				total: 1000,
				product: { id: 7, name: 'Widget', category: 'Tools' },
			},
		],
		...over,
	}
}

describe('ReportsService', () => {
	let service: ReportsService

	beforeEach(async () => {
		const module = await Test.createTestingModule({
			providers: [
				ReportsService,
				{ provide: REPORTS_REPOSITORY, useValue: repositoryMock },
				{ provide: TenantContext, useValue: tenantContextMock },
			],
		}).compile()

		service = module.get(ReportsService)
		jest.clearAllMocks()
		tenantContextMock.isAdmin.mockReturnValue(false)
		tenantContextMock.requireSellerId.mockReturnValue('seller-1')
	})

	describe('tenant scoping', () => {
		it('scopes queries to the current seller for non-admins', async () => {
			repositoryMock.findOrdersWithItems.mockResolvedValueOnce([])
			repositoryMock.findOrdersBasic.mockResolvedValueOnce([])

			await service.getFullReport('month')

			expect(repositoryMock.findOrdersWithItems).toHaveBeenCalledWith(
				{ seller_id: 'seller-1' },
				expect.anything(),
			)
		})

		it('passes an empty filter (no seller scope) for admins', async () => {
			tenantContextMock.isAdmin.mockReturnValue(true)
			repositoryMock.findOrdersWithItems.mockResolvedValueOnce([])
			repositoryMock.findOrdersBasic.mockResolvedValueOnce([])

			await service.getFullReport('month')

			expect(repositoryMock.findOrdersWithItems).toHaveBeenCalledWith({}, expect.anything())
			expect(tenantContextMock.requireSellerId).not.toHaveBeenCalled()
		})
	})

	describe('getFullReport', () => {
		it('computes revenue, order count and average ticket with period-over-period change', async () => {
			repositoryMock.findOrdersWithItems.mockResolvedValueOnce([
				orderWithItems({ id: 1, total: 1000 }),
				orderWithItems({ id: 2, total: 3000 }),
			])
			// previous period: single order of 2000 -> revenue change = (4000-2000)/2000 = 100%
			repositoryMock.findOrdersBasic.mockResolvedValueOnce([
				{ id: 9, total: 2000, status: 'delivered', createdAt: new Date('2026-05-01T10:00:00Z') },
			])

			const res = await service.getFullReport('month')

			expect(res.summary.totalRevenue).toBe(4000)
			expect(res.summary.totalOrders).toBe(2)
			expect(res.summary.avgTicket).toBe(2000)
			expect(res.summary.revenueChange).toBe(100)
			expect(res.topProducts[0]).toEqual(
				expect.objectContaining({ name: 'Widget', vendas: 4, receita: 2000 }),
			)
		})

		it('returns 0 change when there is no previous-period baseline', async () => {
			repositoryMock.findOrdersWithItems.mockResolvedValueOnce([orderWithItems({ total: 500 })])
			repositoryMock.findOrdersBasic.mockResolvedValueOnce([])

			const res = await service.getFullReport('month')

			expect(res.summary.totalRevenue).toBe(500)
			expect(res.summary.revenueChange).toBe(0)
			expect(res.summary.ordersChange).toBe(0)
		})

		it('excludes canceled orders from revenue but still counts them as orders', async () => {
			repositoryMock.findOrdersWithItems.mockResolvedValueOnce([
				orderWithItems({ id: 1, total: 1000, status: 'delivered' }),
				orderWithItems({ id: 2, total: 5000, status: 'canceled' }),
			])
			repositoryMock.findOrdersBasic.mockResolvedValueOnce([])

			const res = await service.getFullReport('month')

			expect(res.summary.totalRevenue).toBe(1000) // 5000 canceled dropped from revenue
			expect(res.summary.totalOrders).toBe(2) // both still counted
			expect(res.summary.avgTicket).toBe(500) // 1000 / 2
		})
	})

	describe('getSalesReport', () => {
		it('aggregates totals, status counts and recent orders', async () => {
			repositoryMock.findOrdersWithItems.mockResolvedValueOnce([
				orderWithItems({ id: 1, total: 1000, status: 'delivered' }),
				orderWithItems({ id: 2, total: 500, status: 'pending' }),
			])

			const res = await service.getSalesReport()

			expect(res.summary.totalSales).toBe(1500)
			expect(res.summary.totalOrders).toBe(2)
			expect(res.summary.avgOrderValue).toBe(750)
			expect(res.salesByStatus).toEqual({ delivered: 1, pending: 1 })
			expect(res.recentOrders).toHaveLength(2)
		})

		it('drops canceled orders from sales totals but counts them as orders', async () => {
			repositoryMock.findOrdersWithItems.mockResolvedValueOnce([
				orderWithItems({ id: 1, total: 1000, status: 'delivered' }),
				orderWithItems({ id: 2, total: 4000, status: 'canceled' }),
			])

			const res = await service.getSalesReport()

			expect(res.summary.totalSales).toBe(1000) // canceled excluded from money
			expect(res.summary.totalOrders).toBe(2) // but still an order
			expect(res.salesByStatus).toEqual({ delivered: 1, canceled: 1 })
		})
	})

	describe('getProductsReport', () => {
		it('ranks products by quantity sold', async () => {
			repositoryMock.findOrdersWithItems.mockResolvedValueOnce([
				orderWithItems({
					Order_item: [
						{
							product_id: 1,
							quantity: 1,
							total: 100,
							product: { id: 1, name: 'A', category: 'X' },
						},
						{
							product_id: 2,
							quantity: 5,
							total: 500,
							product: { id: 2, name: 'B', category: 'X' },
						},
					],
				}),
			])

			const res = await service.getProductsReport()

			expect(res.topProducts[0].product.name).toBe('B')
			expect(res.topProducts[0].quantitySold).toBe(5)
			expect(res.salesByCategory[0]).toEqual({ category: 'X', value: 600 })
		})

		it('counts units from canceled orders but excludes their revenue', async () => {
			repositoryMock.findOrdersWithItems.mockResolvedValueOnce([
				orderWithItems({
					id: 1,
					status: 'delivered',
					Order_item: [
						{
							product_id: 1,
							quantity: 2,
							total: 200,
							product: { id: 1, name: 'A', category: 'X' },
						},
					],
				}),
				orderWithItems({
					id: 2,
					status: 'canceled',
					Order_item: [
						{
							product_id: 1,
							quantity: 3,
							total: 300,
							product: { id: 1, name: 'A', category: 'X' },
						},
					],
				}),
			])

			const res = await service.getProductsReport()

			const a = res.topProducts.find((p) => p.product.name === 'A')
			expect(a?.quantitySold).toBe(5) // 2 + 3 units counted
			expect(a?.totalRevenue).toBe(200) // only the non-canceled 200
			expect(res.salesByCategory[0]).toEqual({ category: 'X', value: 200 })
		})
	})

	describe('getChartsData', () => {
		it('builds status distribution percentages and revenue metrics', async () => {
			repositoryMock.findOrdersForCharts.mockResolvedValueOnce([
				{ createdAt: new Date('2026-06-10T09:00:00Z'), total: 1000, status: 'delivered' },
				{ createdAt: new Date('2026-06-10T09:00:00Z'), total: 1000, status: 'delivered' },
				{ createdAt: new Date('2026-06-11T09:00:00Z'), total: 2000, status: 'canceled' },
			])

			const res = await service.getChartsData('month')

			// The 2000 canceled order brings no revenue, but is still one of the 3 orders.
			expect(res.metrics.totalRevenue).toBe(2000)
			expect(res.metrics.totalOrders).toBe(3)
			const delivered = res.statusDistribution.find((s) => s.status === 'delivered')
			expect(delivered).toEqual({ status: 'delivered', count: 2, percentage: 67 })
			const canceled = res.statusDistribution.find((s) => s.status === 'canceled')
			expect(canceled).toEqual({ status: 'canceled', count: 1, percentage: 33 })
		})
	})

	describe('getGrowthMetrics', () => {
		it('computes month-over-month growth percentages', async () => {
			repositoryMock.aggregateOrders
				.mockResolvedValueOnce({ _sum: { total: 3000 }, _count: 6 }) // current
				.mockResolvedValueOnce({ _sum: { total: 1500 }, _count: 3 }) // previous
			repositoryMock.countCustomers
				.mockResolvedValueOnce(10) // current
				.mockResolvedValueOnce(5) // previous

			const res = await service.getGrowthMetrics()

			expect(res.currentMonth.revenue).toBe(3000)
			expect(res.growth.revenue).toBe(100)
			expect(res.growth.orders).toBe(100)
			expect(res.growth.customers).toBe(100)
		})
	})

	describe('getCustomersReport', () => {
		it('maps top customers and computes conversion rate', async () => {
			repositoryMock.groupOrdersByCustomer.mockResolvedValueOnce([
				{ customer_id: 'c1', _sum: { total: 2000 }, _count: { id: 2 } },
			])
			repositoryMock.findCustomersByIds.mockResolvedValueOnce([
				{ id: 'c1', name: 'Alice', email: 'a@x.com', city: null, state: null },
			])
			repositoryMock.countAllCustomers.mockResolvedValueOnce(4)
			repositoryMock.countActiveCustomers.mockResolvedValueOnce(3)

			const res = await service.getCustomersReport()

			expect(res.topCustomers[0]).toEqual(
				expect.objectContaining({ totalSpent: 2000, orderCount: 2, avgOrderValue: 1000 }),
			)
			expect(res.summary.customersWithOrders).toBe(1)
			expect(res.summary.conversionRate).toBe(25)
		})
	})
})
