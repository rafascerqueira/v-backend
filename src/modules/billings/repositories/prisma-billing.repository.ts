import { Injectable } from '@nestjs/common'
import { PrismaService } from '@/shared/prisma/prisma.service'
import type {
	BillingRecord,
	BillingRepository,
	BillingWithOrder,
	CreateBillingData,
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

	async findAll(filter: Record<string, unknown>): Promise<BillingWithOrder[]> {
		return this.prisma.billing.findMany({
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
		}) as unknown as BillingWithOrder[]
	}

	async findByOrderId(orderId: number, filter: Record<string, unknown>): Promise<BillingRecord[]> {
		return this.prisma.billing.findMany({
			where: { order_id: orderId, ...this.getTenantFilter(), ...filter } as any,
		}) as unknown as BillingRecord[]
	}

	async findById(id: number): Promise<BillingWithOrder | null> {
		return this.prisma.billing.findUnique({
			where: { id },
			include: {
				order: { select: { id: true, order_number: true, seller_id: true, status: true } },
			},
		}) as unknown as BillingWithOrder | null
	}

	async create(data: CreateBillingData): Promise<BillingRecord> {
		return this.prisma.billing.create({
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
		}) as unknown as BillingRecord
	}

	async update(id: number, data: UpdateBillingData): Promise<BillingRecord> {
		const updateData: Record<string, unknown> = { ...data }
		if (data.payment_method !== undefined) updateData.payment_method = data.payment_method
		if (data.payment_status !== undefined) updateData.payment_status = data.payment_status
		if (data.status !== undefined) updateData.status = data.status

		return this.prisma.billing.update({
			where: { id },
			data: updateData as any,
		}) as unknown as BillingRecord
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
