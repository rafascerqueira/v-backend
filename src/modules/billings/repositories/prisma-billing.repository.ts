import { Injectable } from '@nestjs/common'
import { PrismaService } from '@/shared/prisma/prisma.service'
import type {
	BillingRecord,
	BillingRepository,
	BillingWithOrder,
	CreateBillingData,
	UnbilledOrder,
	UpdateBillingData,
} from '@/shared/repositories/billing.repository'
import { TenantContext } from '@/shared/tenant/tenant.context'

@Injectable()
export class PrismaBillingRepository implements BillingRepository {
	constructor(
		private readonly prisma: PrismaService,
		private readonly tenantContext: TenantContext,
	) {}

	private getTenantFilter() {
		if (this.tenantContext.isAdmin()) {
			return {}
		}
		return { order: { seller_id: this.tenantContext.requireSellerId() } }
	}

	/** Compute overdue in-memory: stored `pending`/`partial` + past due_date → overdue */
	private applyOverdue(billing: BillingRecord): BillingRecord {
		if (
			(billing.status === 'pending' || billing.status === 'partial') &&
			billing.due_date !== null &&
			billing.due_date < new Date()
		) {
			return { ...billing, status: 'overdue' }
		}
		return billing
	}

	async findAll(filter: Record<string, unknown>): Promise<BillingWithOrder[]> {
		const rows = await this.prisma.billing.findMany({
			where: { ...this.getTenantFilter(), ...filter } as any,
			orderBy: { createdAt: 'desc' },
			include: {
				order: {
					select: {
						id: true,
						order_number: true,
						seller_id: true,
						status: true,
						customer: {
							select: {
								id: true,
								name: true,
							},
						},
					},
				},
			},
		})

		return rows.map((r) =>
			this.applyOverdue(r as unknown as BillingWithOrder),
		) as BillingWithOrder[]
	}

	async findByOrderId(orderId: number, filter: Record<string, unknown>): Promise<BillingRecord[]> {
		const rows = await this.prisma.billing.findMany({
			where: { order_id: orderId, ...this.getTenantFilter(), ...filter } as any,
		})
		return rows.map((r) => this.applyOverdue(r as unknown as BillingRecord))
	}

	async findById(id: number): Promise<BillingWithOrder | null> {
		const row = await this.prisma.billing.findUnique({
			where: { id },
			include: {
				order: { select: { id: true, order_number: true, seller_id: true, status: true } },
			},
		})
		if (!row) return null
		return this.applyOverdue(row as unknown as BillingWithOrder) as BillingWithOrder
	}

	async findUnbilledPerSaleOrders(): Promise<UnbilledOrder[]> {
		const tenantFilter = this.tenantContext.isAdmin()
			? {}
			: { seller_id: this.tenantContext.requireSellerId() }

		const orders = await this.prisma.order.findMany({
			where: {
				...tenantFilter,
				customer: { billing_mode: 'per_sale' as any },
				Billing: { none: {} },
				status: { not: 'canceled' as any },
			},
			select: {
				id: true,
				order_number: true,
				total: true,
				seller_id: true,
			},
		})
		return orders as unknown as UnbilledOrder[]
	}

	async create(data: CreateBillingData): Promise<BillingRecord> {
		const row = await this.prisma.billing.create({
			data: {
				order_id: data.order_id,
				billing_number: data.billing_number,
				total_amount: data.total_amount,
				paid_amount: data.paid_amount,
				payment_method: data.payment_method as any,
				payment_status: data.payment_status as any,
				status: data.status as any,
				due_date: data.due_date,
				payment_date: data.payment_date,
				notes: data.notes,
			},
		})
		return this.applyOverdue(row as unknown as BillingRecord)
	}

	async update(id: number, data: UpdateBillingData): Promise<BillingRecord> {
		const row = await this.prisma.billing.update({
			where: { id },
			data: {
				...data,
				payment_method: data.payment_method as any,
				payment_status: data.payment_status as any,
				status: data.status as any,
			} as any,
		})
		return this.applyOverdue(row as unknown as BillingRecord)
	}

	async delete(id: number): Promise<void> {
		await this.prisma.billing.delete({ where: { id } })
	}

	async verifyOrderAccess(
		orderId: number,
		sellerId: string | null,
		isAdmin: boolean,
	): Promise<{ id: number; seller_id: string } | null> {
		const order = await this.prisma.order.findUnique({
			where: { id: orderId },
			select: { id: true, seller_id: true },
		})
		if (!order) return null
		if (!isAdmin && order.seller_id !== sellerId) return null
		return order
	}
}
