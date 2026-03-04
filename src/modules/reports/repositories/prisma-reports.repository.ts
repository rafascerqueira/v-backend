import { Injectable } from '@nestjs/common'
import { PrismaService } from '@/shared/prisma/prisma.service'
import type {
	AggregateResult,
	CustomerBasic,
	CustomerOrderGroup,
	OrderBasic,
	OrderForCharts,
	OrderWithItems,
	ReportsRepository,
} from '@/shared/repositories/reports.repository'

@Injectable()
export class PrismaReportsRepository implements ReportsRepository {
	constructor(private readonly prisma: PrismaService) {}

	async findOrdersWithItems(
		tenantFilter: Record<string, unknown>,
		dateFilter?: { gte: Date; lte: Date },
	): Promise<OrderWithItems[]> {
		return this.prisma.order.findMany({
			where: {
				...tenantFilter,
				...(dateFilter && { createdAt: dateFilter }),
			},
			include: {
				customer: { select: { name: true } },
				Order_item: {
					include: {
						product: {
							select: { id: true, name: true, sku: true, category: true },
						},
					},
				},
			},
			orderBy: { createdAt: 'desc' },
		}) as unknown as OrderWithItems[]
	}

	async findOrdersBasic(
		tenantFilter: Record<string, unknown>,
		dateFilter?: { gte: Date; lte: Date },
	): Promise<OrderBasic[]> {
		return this.prisma.order.findMany({
			where: {
				...tenantFilter,
				...(dateFilter && { createdAt: dateFilter }),
			},
		}) as unknown as OrderBasic[]
	}

	async findOrdersForCharts(
		tenantFilter: Record<string, unknown>,
		dateFilter: { gte: Date; lte: Date },
	): Promise<OrderForCharts[]> {
		return this.prisma.order.findMany({
			where: { ...tenantFilter, createdAt: dateFilter },
			select: { createdAt: true, total: true, status: true },
		}) as unknown as OrderForCharts[]
	}

	async aggregateOrders(
		tenantFilter: Record<string, unknown>,
		dateFilter: { gte: Date; lte?: Date },
	): Promise<AggregateResult> {
		const where: Record<string, unknown> = {
			...tenantFilter,
			createdAt: dateFilter,
		}
		const result = await this.prisma.order.aggregate({
			where,
			_sum: { total: true },
			_count: true,
		})
		return { _sum: { total: result._sum.total }, _count: result._count }
	}

	async countCustomers(
		tenantFilter: Record<string, unknown>,
		dateFilter?: { gte: Date; lte?: Date },
	): Promise<number> {
		return this.prisma.customer.count({
			where: {
				...tenantFilter,
				...(dateFilter && { createdAt: dateFilter }),
			},
		})
	}

	async countAllCustomers(tenantFilter: Record<string, unknown>): Promise<number> {
		return this.prisma.customer.count({ where: tenantFilter })
	}

	async countActiveCustomers(tenantFilter: Record<string, unknown>): Promise<number> {
		return this.prisma.customer.count({
			where: { ...tenantFilter, active: true },
		})
	}

	async groupOrdersByCustomer(
		tenantFilter: Record<string, unknown>,
		limit: number,
	): Promise<CustomerOrderGroup[]> {
		return this.prisma.order.groupBy({
			by: ['customer_id'],
			where: tenantFilter,
			_sum: { total: true },
			_count: { id: true },
			orderBy: { _sum: { total: 'desc' } },
			take: limit,
		}) as unknown as CustomerOrderGroup[]
	}

	async findCustomersByIds(ids: string[]): Promise<CustomerBasic[]> {
		return this.prisma.customer.findMany({
			where: { id: { in: ids } },
			select: { id: true, name: true, email: true, city: true, state: true },
		}) as unknown as CustomerBasic[]
	}
}
