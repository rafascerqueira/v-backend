import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { isSequentialOrderNumber } from '@/modules/orders/order-numbering'
import { computeDueDate } from '@/shared/billing/billing-scheduler'
import { deriveBillingStatus } from '@/shared/billing/billing-status'
import { OutboxRelayService } from '@/shared/events/outbox-relay.service'
import { hashRequest } from '@/shared/idempotency/request-hash'
import { RedisService } from '@/shared/redis/redis.service'
import {
	BILLING_REPOSITORY,
	type BillingRepository,
} from '@/shared/repositories/billing.repository'
import {
	BILLING_PAYMENT_REPOSITORY,
	type BillingPaymentRepository,
} from '@/shared/repositories/billing-payment.repository'
import { TenantContext } from '@/shared/tenant/tenant.context'
import type { RecordPaymentDto, ReversePaymentDto } from '../dto/billing-payment.dto'
import type { CreateBillingDto } from '../dto/create-billing.dto'
import type { UpdateBillingDto } from '../dto/update-billing.dto'

export const BILLING_PAYMENT_SCOPES = {
	record: 'billings.payments.record',
	reverse: 'billings.payments.reverse',
} as const

/** Notes on ledger entries created by the pre-ledger endpoints (legacy paths). */
export const LEGACY_PAYMENT_NOTES = {
	patch: 'Registrado pela edição da cobrança',
	create: 'Registrado na criação da cobrança',
} as const

@Injectable()
export class BillingsService {
	private readonly logger = new Logger(BillingsService.name)

	constructor(
		@Inject(BILLING_REPOSITORY) private readonly billingRepository: BillingRepository,
		@Inject(BILLING_PAYMENT_REPOSITORY) private readonly payments: BillingPaymentRepository,
		private readonly tenantContext: TenantContext,
		private readonly redis: RedisService,
		private readonly outboxRelay: OutboxRelayService,
	) {}

	async syncBillings(): Promise<{ created: number; orders: string[] }> {
		const unbilledOrders = await this.billingRepository.findUnbilledPerSaleOrders()
		const created: string[] = []

		for (const order of unbilledOrders) {
			try {
				const billingNumber = billingNumberForOrder(order.order_number, order.id)
				await this.billingRepository.create({
					order_id: order.id,
					billing_number: billingNumber,
					total_amount: order.total,
					paid_amount: 0,
					payment_method: 'cash',
					...deriveBillingStatus(0, order.total),
					// per_sale: the sale date is the due date (see computeDueDate); without
					// this the billing would render as 01/01/1970 in the UI.
					due_date: computeDueDate('per_sale', null, order.createdAt) ?? undefined,
				})
				created.push(billingNumber)
				this.logger.log(`Cobrança ${billingNumber} criada para pedido ${order.order_number}`)
			} catch (error) {
				this.logger.warn(`Falha ao criar cobrança para pedido ${order.order_number}: ${error}`)
			}
		}

		return { created: created.length, orders: created }
	}

	async findAll(status?: string) {
		const filter: Record<string, unknown> = {}
		// For overdue, query pending/partial and let the repository compute it
		if (status && status !== 'overdue') {
			filter.status = status
		}
		const billings = await this.billingRepository.findAll(filter)
		if (status === 'overdue') {
			return billings.filter((b) => b.status === 'overdue')
		}
		return billings
	}

	async listByOrder(orderId: number) {
		return this.billingRepository.findByOrderId(orderId, {})
	}

	async create(orderId: number, dto: CreateBillingDto) {
		const order = await this.billingRepository.verifyOrderAccess(
			orderId,
			this.tenantContext.getSellerId() ?? null,
			this.tenantContext.isAdmin(),
		)
		if (!order) {
			throw new NotFoundException('Pedido não encontrado')
		}

		if (dto.paid_amount > dto.total_amount) {
			throw new BadRequestException('O valor pago não pode ser maior que o total da cobrança')
		}

		// The charge starts unpaid; money only enters through the ledger, so an amount
		// already paid becomes its first entry — created in the same transaction.
		const { billingId, sellerId } = await this.payments.openCharge({
			orderId,
			billingNumber: dto.billing_number,
			totalAmount: dto.total_amount,
			paymentMethod: dto.payment_method,
			dueDate: dto.due_date ? new Date(dto.due_date) : undefined,
			notes: dto.notes,
			initialPayment:
				dto.paid_amount > 0
					? {
							amount: dto.paid_amount,
							paidAt: dto.payment_date ? new Date(dto.payment_date) : new Date(),
							note: LEGACY_PAYMENT_NOTES.create,
							createdBy: this.tenantContext.requireSellerId(),
						}
					: undefined,
		})
		if (dto.paid_amount > 0) await this.afterMoneyChange(sellerId)
		return this.requireBilling(billingId)
	}

	/**
	 * Edits a charge. `paid_amount` and `payment_date` are DEPRECATED here (use
	 * POST /billings/:id/payments): during the transition a higher paid_amount is
	 * recorded as a ledger payment of the difference, and a lower one is refused
	 * (money only goes back through a reversal).
	 */
	async update(id: number, dto: UpdateBillingDto) {
		// Validated and applied under the charge lock (tenant-scoped: a foreign or
		// missing charge is a 404, never a 403 that would leak that the id exists).
		const { recorded, sellerId } = await this.payments.updateCharge({
			billingId: id,
			totalAmount: dto.total_amount,
			paidAmountTarget: dto.paid_amount,
			paymentMethod: dto.payment_method,
			fallbackMethod: 'cash',
			paidAt: dto.payment_date ? new Date(dto.payment_date) : undefined,
			dueDate: dto.due_date ? new Date(dto.due_date) : dto.due_date === null ? null : undefined,
			notes: dto.notes,
			legacyNote: LEGACY_PAYMENT_NOTES.patch,
			createdBy: this.tenantContext.requireSellerId(),
		})

		await this.afterMoneyChange(sellerId, recorded !== null)
		return this.requireBilling(id)
	}

	/**
	 * Voids a charge. Cancellation is an explicit lifecycle action — not something
	 * derived from amounts — so it lives in its own method (and route) instead of the
	 * amount-driven update path. Sets the terminal canceled state, which update() then
	 * preserves on any later edit. Recorded payments stay in the ledger.
	 */
	async cancel(id: number) {
		// Tenant-scoped findById → foreign/missing billing is a 404 (no 403 leak).
		const billing = await this.billingRepository.findById(id)
		if (!billing) {
			throw new NotFoundException('Cobrança não encontrada')
		}

		const result = await this.billingRepository.update(id, {
			status: 'canceled',
			payment_status: 'canceled',
		})

		await this.invalidateStats(billing.seller_id)
		return result
	}

	/** 404 for a missing/foreign charge; 409 HAS_PAYMENTS when it has ledger entries. */
	async delete(id: number) {
		const { sellerId } = await this.billingRepository.delete(id)
		await this.invalidateStats(sellerId)
	}

	async listPayments(billingId: number) {
		const entries = await this.payments.list(billingId)
		if (!entries) throw new NotFoundException('Cobrança não encontrada')
		return entries
	}

	async recordPayment(billingId: number, dto: RecordPaymentDto, idempotencyKey?: string) {
		// paid_at bounds (not in the future, not before 2000) are enforced by the
		// repository, on every path that records money.
		const { entry, sellerId, replayed } = await this.payments.record({
			billingId,
			amount: dto.amount,
			method: dto.method,
			paidAt: dto.paid_at ? new Date(dto.paid_at) : new Date(),
			note: dto.note,
			createdBy: this.tenantContext.requireSellerId(),
			idempotency: idempotencyKey
				? {
						scope: BILLING_PAYMENT_SCOPES.record,
						key: idempotencyKey,
						requestHash: hashRequest({ billingId, ...dto }),
					}
				: undefined,
		})
		if (!replayed) await this.afterMoneyChange(sellerId)
		return { payment: entry, billing: await this.requireBilling(billingId) }
	}

	async reversePayment(
		billingId: number,
		paymentId: number,
		dto: ReversePaymentDto,
		idempotencyKey?: string,
	) {
		const { entry, sellerId, replayed } = await this.payments.reverse({
			billingId,
			paymentId,
			reason: dto.reason,
			createdBy: this.tenantContext.requireSellerId(),
			idempotency: idempotencyKey
				? {
						scope: BILLING_PAYMENT_SCOPES.reverse,
						key: idempotencyKey,
						requestHash: hashRequest({ billingId, paymentId, ...dto }),
					}
				: undefined,
		})
		if (!replayed) await this.afterMoneyChange(sellerId)
		return { reversal: entry, billing: await this.requireBilling(billingId) }
	}

	private async requireBilling(id: number) {
		const billing = await this.billingRepository.findById(id)
		if (!billing) throw new NotFoundException('Cobrança não encontrada')
		return billing
	}

	/** Dashboard KPIs read paid amounts; a recorded entry also emitted an event. */
	private async afterMoneyChange(sellerId: string, ledgerWritten = true): Promise<void> {
		await this.invalidateStats(sellerId)
		// Not awaited: kick() never throws, but a degraded Redis would delay the response.
		if (ledgerWritten) void this.outboxRelay.kick()
	}

	/** The charge OWNER's cache — not the caller's, which differs when an admin acts. */
	private async invalidateStats(sellerId: string): Promise<void> {
		await this.redis.delete(`dashboard:stats:${sellerId}`)
	}
}

/**
 * Charge number for a per-sale order billed by the sync: COB-n mirrors a
 * server-numbered PED-n; older orders keep using their own number, as before.
 */
function billingNumberForOrder(orderNumber: string, orderId: number): string {
	if (isSequentialOrderNumber(orderNumber)) return `COB-${orderNumber.slice('PED-'.length)}`
	return orderNumber.replace(/^ORD/, 'COB') || `COB-${orderId}`
}
