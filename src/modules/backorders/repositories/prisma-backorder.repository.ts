import { Injectable } from '@nestjs/common'
import { PrismaService } from '@/shared/prisma/prisma.service'
import type {
	BackorderRepository,
	BackorderStatus,
	BackorderSummary,
	BackorderWithRelations,
} from '@/shared/repositories/backorder.repository'
import { TenantContext } from '@/shared/tenant/tenant.context'

@Injectable()
export class PrismaBackorderRepository implements BackorderRepository {
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

	async findPendingByProduct(productId: number): Promise<BackorderWithRelations[]> {
		return this.list({ productId, status: 'pending' })
	}

	async list(params: {
		productId?: number
		status?: BackorderStatus
	}): Promise<BackorderWithRelations[]> {
		const { productId, status } = params
		return this.prisma.backorder.findMany({
			where: {
				...this.getTenantFilter(),
				...(productId ? { product_id: productId } : {}),
				...(status ? { status } : {}),
			},
			// FIFO order — same ordering the restock allocation uses, so the list
			// mirrors the sequence in which arrivals will be applied.
			orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
			include: {
				order: { select: { id: true, order_number: true, status: true } },
				product: { select: { id: true, name: true } },
			},
		}) as unknown as BackorderWithRelations[]
	}

	async summaryByProductIds(productIds: number[]): Promise<Map<number, BackorderSummary>> {
		const summary = new Map<number, BackorderSummary>()
		if (productIds.length === 0) return summary

		const rows = await this.prisma.backorder.findMany({
			where: {
				...this.getTenantFilter(),
				product_id: { in: productIds },
				status: 'pending',
			},
			select: { product_id: true, order_id: true, quantity: true, fulfilled_quantity: true },
		})

		// Aggregate in memory: owed = remaining units, pending_orders_count = distinct
		// orders. groupBy can't count distinct orders per product, and pending volumes
		// per seller are small, so a plain scan is both correct and cheap.
		const ordersByProduct = new Map<number, Set<number>>()
		for (const row of rows) {
			const owed = row.quantity - row.fulfilled_quantity
			if (owed <= 0) continue
			const current = summary.get(row.product_id) ?? { owed: 0, pending_orders_count: 0 }
			current.owed += owed
			summary.set(row.product_id, current)

			let orders = ordersByProduct.get(row.product_id)
			if (!orders) {
				orders = new Set<number>()
				ordersByProduct.set(row.product_id, orders)
			}
			orders.add(row.order_id)
		}

		for (const [productId, orders] of ordersByProduct) {
			const current = summary.get(productId)
			if (current) current.pending_orders_count = orders.size
		}

		return summary
	}
}
