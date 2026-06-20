import { Test } from '@nestjs/testing'
import { PrismaService } from '@/shared/prisma/prisma.service'
import { PrismaReportsRepository } from './prisma-reports.repository'

// Proves the SQL-aggregate KPI paths exclude canceled orders from money sums while
// still counting them as orders (the "revenue only" rule the in-memory paths follow).
describe('PrismaReportsRepository', () => {
	let repo: PrismaReportsRepository
	let prisma: any

	beforeEach(async () => {
		prisma = {
			order: {
				aggregate: jest.fn(),
				groupBy: jest.fn(),
			},
		}
		const module = await Test.createTestingModule({
			providers: [PrismaReportsRepository, { provide: PrismaService, useValue: prisma }],
		}).compile()
		repo = module.get(PrismaReportsRepository)
	})

	describe('aggregateOrders', () => {
		it('sums revenue without canceled orders but counts every order', async () => {
			prisma.order.aggregate
				.mockResolvedValueOnce({ _sum: { total: 1000 } }) // revenue (non-canceled)
				.mockResolvedValueOnce({ _count: 3 }) // count (all)

			const result = await repo.aggregateOrders({ seller_id: 's1' }, { gte: new Date() })

			expect(result).toEqual({ _sum: { total: 1000 }, _count: 3 })

			const sumWhere = prisma.order.aggregate.mock.calls[0][0].where
			const countWhere = prisma.order.aggregate.mock.calls[1][0].where
			expect(sumWhere.status).toEqual({ not: 'canceled' })
			expect(sumWhere.seller_id).toBe('s1')
			expect(countWhere.status).toBeUndefined() // count keeps canceled orders
		})
	})

	describe('groupOrdersByCustomer', () => {
		it('ranks spend without canceled orders but reports each customer total order count', async () => {
			prisma.order.groupBy
				.mockResolvedValueOnce([{ customer_id: 'c1', _sum: { total: 2000 } }]) // revenue
				.mockResolvedValueOnce([{ customer_id: 'c1', _count: { id: 5 } }]) // count (all)

			const result = await repo.groupOrdersByCustomer({ seller_id: 's1' }, 10)

			expect(result).toEqual([{ customer_id: 'c1', _sum: { total: 2000 }, _count: { id: 5 } }])

			const revenueWhere = prisma.order.groupBy.mock.calls[0][0].where
			const countWhere = prisma.order.groupBy.mock.calls[1][0].where
			expect(revenueWhere.status).toEqual({ not: 'canceled' })
			expect(countWhere.status).toBeUndefined()
			expect(countWhere.customer_id).toEqual({ in: ['c1'] })
		})

		it('skips the count query when no customers have revenue', async () => {
			prisma.order.groupBy.mockResolvedValueOnce([])

			const result = await repo.groupOrdersByCustomer({ seller_id: 's1' }, 10)

			expect(result).toEqual([])
			expect(prisma.order.groupBy).toHaveBeenCalledTimes(1)
		})
	})
})
