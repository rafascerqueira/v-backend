import { ConflictException, Injectable, NotFoundException } from '@nestjs/common'
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

	// Billings carry their seller (Phase 1A): filter on it directly, no join.
	private getTenantFilter() {
		if (this.tenantContext.isAdmin()) {
			return {}
		}
		return { seller_id: this.tenantContext.requireSellerId() }
	}

	/**
	 * Compute overdue in-memory: stored `pending`/`partial` whose due date is before
	 * today → overdue. The comparison is day-granular (against local midnight, matching
	 * how due dates are stored) so a billing due *today* — including a per_sale charge
	 * due on the sale day — is not flagged overdue until the day after.
	 */
	private applyOverdue(billing: BillingRecord): BillingRecord {
		if (
			(billing.status === 'pending' || billing.status === 'partial') &&
			billing.due_date !== null
		) {
			const startOfToday = new Date()
			startOfToday.setHours(0, 0, 0, 0)
			if (billing.due_date < startOfToday) {
				return { ...billing, status: 'overdue' }
			}
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
		// Tenant-scoped so a foreign billing looks non-existent (→ service returns 404,
		// never a 403 that leaks existence).
		const row = await this.prisma.billing.findFirst({
			where: { id, ...this.getTenantFilter() } as any,
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
				createdAt: true,
			},
		})
		return orders as unknown as UnbilledOrder[]
	}

	async create(data: CreateBillingData): Promise<BillingRecord> {
		// The charge belongs to its order's seller — derived here, never taken from the
		// caller, so billing numbers (unique per seller) stay scoped to the right tenant.
		const order = await this.prisma.order.findUnique({
			where: { id: data.order_id },
			select: { seller_id: true },
		})
		if (!order) throw new NotFoundException('Pedido não encontrado')

		const row = await this.prisma.billing.create({
			data: {
				order_id: data.order_id,
				seller_id: order.seller_id,
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
		// Repo-level ownership gate: never mutate a billing by bare id without
		// confirming it belongs to the caller's tenant first.
		const existing = await this.findById(id)
		if (!existing) throw new NotFoundException('Cobrança não encontrada')

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

	/**
	 * Financial history is never erased (D2): a charge with ledger entries is
	 * canceled, not deleted (409 HAS_PAYMENTS). The row lock keeps a payment from
	 * landing between the check and the delete; the ledger FK is the DB backstop.
	 */
	async delete(id: number): Promise<{ sellerId: string }> {
		return this.prisma.$transaction(async (tx) => {
			const sellerId = this.tenantContext.isAdmin() ? null : this.tenantContext.requireSellerId()
			const [row] = await tx.$queryRaw<{ id: number; seller_id: string }[]>`
				SELECT id, seller_id FROM billings
				WHERE id = ${id} AND (${sellerId}::text IS NULL OR seller_id = ${sellerId}::text)
				FOR UPDATE`
			if (!row) throw new NotFoundException('Cobrança não encontrada')

			const entries = await tx.billingPayment.count({ where: { billing_id: id } })
			if (entries > 0) {
				throw new ConflictException({
					message:
						'Esta cobrança tem pagamentos registrados e não pode ser excluída. Cancele a cobrança em vez de excluí-la.',
					error: 'Conflict',
					code: 'HAS_PAYMENTS',
				})
			}
			await tx.billing.delete({ where: { id } })
			return { sellerId: row.seller_id }
		})
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
