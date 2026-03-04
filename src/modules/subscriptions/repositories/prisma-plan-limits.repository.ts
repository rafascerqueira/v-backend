import { Injectable } from '@nestjs/common'
import { PrismaService } from '@/shared/prisma/prisma.service'
import type { PlanLimitsRepository } from '@/shared/repositories/plan-limits.repository'

@Injectable()
export class PrismaPlanLimitsRepository implements PlanLimitsRepository {
	constructor(private readonly prisma: PrismaService) {}

	async countProducts(sellerId: string): Promise<number> {
		return this.prisma.product.count({ where: { seller_id: sellerId } })
	}

	async countCustomers(sellerId: string): Promise<number> {
		return this.prisma.customer.count({ where: { seller_id: sellerId } })
	}

	async countOrdersThisMonth(sellerId: string, startOfMonth: Date): Promise<number> {
		return this.prisma.order.count({
			where: {
				seller_id: sellerId,
				createdAt: { gte: startOfMonth },
			},
		})
	}
}
