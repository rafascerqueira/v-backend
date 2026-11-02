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
	type PaymentMethod,
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

/** Clock skew allowed for a client-sent paid_at; anything later is "in the future". */
const PAID_AT_FUTURE_TOLERANCE_MS = 5 * 60 * 1000

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

		const { due_date, payment_date, paid_amount, ...rest } = dto
		// The charge starts unpaid; money only enters through the ledger, so an
		// amount already paid becomes its first entry (paid_amount = ledger balance).
		const billing = await this.billingRepository.create({
			order_id: orderId,
			...rest,
			paid_amount: 0,
			...deriveBillingStatus(0, dto.total_amount),
			due_date: due_date ? new Date(due_date) : undefined,
		})
		if (paid_amount <= 0) return billing

		await this.payments.record({
			billingId: billing.id,
			amount: paid_amount,
			method: rest.payment_method,
			paidAt: payment_date ? new Date(payment_date) : new Date(),
			note: LEGACY_PAYMENT_NOTES.create,
			createdBy: this.tenantContext.requireSellerId(),
		})
		await this.afterMoneyChange()
		return this.requireBilling(billing.id)
	}

	/**
	 * Edits a charge. `paid_amount` and `payment_date` are DEPRECATED here (use
	 * POST /billings/:id/payments): during the transition a higher paid_amount is
	 * recorded as a ledger payment of the difference, and a lower one is refused
	 * (money only goes back through a reversal).
	 */
	async update(id: number, dto: UpdateBillingDto) {
		// findById is tenant-scoped: a foreign or missing billing returns null → 404.
		// We deliberately don't 403 here (that would leak that the id exists).
		const billing = await this.billingRepository.findById(id)
		if (!billing) {
			throw new NotFoundException('Cobrança não encontrada')
		}

		const newTotal = dto.total_amount ?? billing.total_amount
		const delta = dto.paid_amount === undefined ? 0 : dto.paid_amount - billing.paid_amount

		if (newTotal < billing.paid_amount) {
			throw new BadRequestException(
				'O total não pode ficar abaixo do valor já pago. Estorne um pagamento antes de reduzir o total.',
			)
		}
		if (delta < 0) {
			throw new BadRequestException(
				'Para reduzir o valor pago, estorne o pagamento no histórico da cobrança.',
			)
		}
		if (billing.paid_amount + delta > newTotal) {
			throw new BadRequestException('O valor pago não pode ser maior que o total da cobrança')
		}
		if (delta > 0 && billing.status === 'canceled') {
			throw new BadRequestException(
				'Cobrança cancelada não aceita pagamento. Estornos continuam permitidos.',
			)
		}

		const { due_date, payment_date, paid_amount: _paid, ...rest } = dto

		// Re-derive status/payment_status from the money, except for a canceled
		// billing: cancellation is a terminal state owned by order cancellation, so
		// editing it must not resurrect it as pending/paid.
		const derived =
			billing.status === 'canceled' ? {} : deriveBillingStatus(billing.paid_amount, newTotal)
		await this.billingRepository.update(id, {
			...rest,
			...derived,
			due_date: due_date ? new Date(due_date) : due_date === null ? null : undefined,
		})

		if (delta > 0) {
			this.logger.warn(
				`[LEGACY_PAID_AMOUNT] PATCH /billings/${id} raised paid_amount by ${delta}; recorded as a ledger payment`,
			)
			await this.payments.record({
				billingId: id,
				amount: delta,
				method: (rest.payment_method ?? billing.payment_method) as PaymentMethod,
				paidAt: payment_date ? new Date(payment_date) : new Date(),
				note: LEGACY_PAYMENT_NOTES.patch,
				createdBy: this.tenantContext.requireSellerId(),
			})
		}

		await this.afterMoneyChange(delta > 0)
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

		await this.invalidateStats()
		return result
	}

	/** 404 for a missing/foreign charge; 409 HAS_PAYMENTS when it has ledger entries. */
	async delete(id: number) {
		await this.billingRepository.delete(id)
		await this.invalidateStats()
	}

	async listPayments(billingId: number) {
		const entries = await this.payments.list(billingId)
		if (!entries) throw new NotFoundException('Cobrança não encontrada')
		return entries
	}

	async recordPayment(billingId: number, dto: RecordPaymentDto, idempotencyKey?: string) {
		const paidAt = dto.paid_at ? new Date(dto.paid_at) : new Date()
		if (paidAt.getTime() > Date.now() + PAID_AT_FUTURE_TOLERANCE_MS) {
			throw new BadRequestException('A data do pagamento não pode estar no futuro.')
		}

		const { entry, replayed } = await this.payments.record({
			billingId,
			amount: dto.amount,
			method: dto.method,
			paidAt,
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
		if (!replayed) await this.afterMoneyChange()
		return { payment: entry, billing: await this.requireBilling(billingId) }
	}

	async reversePayment(
		billingId: number,
		paymentId: number,
		dto: ReversePaymentDto,
		idempotencyKey?: string,
	) {
		const { entry, replayed } = await this.payments.reverse({
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
		if (!replayed) await this.afterMoneyChange()
		return { reversal: entry, billing: await this.requireBilling(billingId) }
	}

	private async requireBilling(id: number) {
		const billing = await this.billingRepository.findById(id)
		if (!billing) throw new NotFoundException('Cobrança não encontrada')
		return billing
	}

	/** Dashboard KPIs read paid amounts; a recorded entry also emitted an event. */
	private async afterMoneyChange(ledgerWritten = true): Promise<void> {
		await this.invalidateStats()
		// Not awaited: kick() never throws, but a degraded Redis would delay the response.
		if (ledgerWritten) void this.outboxRelay.kick()
	}

	private async invalidateStats(): Promise<void> {
		const sellerId = this.tenantContext.getSellerId()
		if (sellerId) {
			await this.redis.delete(`dashboard:stats:${sellerId}`)
		}
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
