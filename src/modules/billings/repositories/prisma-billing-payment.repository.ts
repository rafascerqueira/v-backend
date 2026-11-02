import {
	BadRequestException,
	ConflictException,
	Injectable,
	NotFoundException,
} from '@nestjs/common'
import type { Prisma } from '@/generated/prisma/client'
import { deriveBillingStatus } from '@/shared/billing/billing-status'
import { summarizeLedger } from '@/shared/billing/ledger'
import { appendDomainEvents } from '@/shared/events/append-domain-events'
import { DOMAIN_EVENT_TYPES } from '@/shared/events/domain-event.types'
import {
	claimIdempotencyKey,
	completeIdempotencyKey,
	type IdempotencyRequest,
} from '@/shared/idempotency/idempotency'
import { formatBRL } from '@/shared/money/format-brl'
import { PrismaService } from '@/shared/prisma/prisma.service'
import type {
	BillingPaymentEntry,
	BillingPaymentRepository,
	LedgerWriteResult,
	RecordPaymentInput,
	ReversePaymentInput,
} from '@/shared/repositories/billing-payment.repository'
import { TenantContext } from '@/shared/tenant/tenant.context'

export const LEDGER_ERROR_CODES = {
	alreadyReversed: 'ALREADY_REVERSED',
} as const

interface LockedBilling {
	id: number
	seller_id: string
	order_id: number
	billing_number: string
	status: string
	total_amount: number
	paid_amount: number
}

type Tx = Prisma.TransactionClient

@Injectable()
export class PrismaBillingPaymentRepository implements BillingPaymentRepository {
	constructor(
		private readonly prisma: PrismaService,
		private readonly tenantContext: TenantContext,
	) {}

	async record(input: RecordPaymentInput): Promise<LedgerWriteResult> {
		return this.prisma.$transaction(async (tx) => {
			const idempotency = this.identity(input.idempotency)
			if (idempotency) {
				const claim = await claimIdempotencyKey(tx, idempotency, 'billing_payment')
				if (!claim.claimed) return this.replay(tx, claim.resourceId)
			}

			const billing = await this.lockBilling(tx, input.billingId)
			if (billing.status === 'canceled') {
				throw new BadRequestException(
					'Cobrança cancelada não aceita pagamento. Estornos continuam permitidos.',
				)
			}
			const open = billing.total_amount - billing.paid_amount
			if (input.amount > open) {
				throw new BadRequestException(
					`O valor (${formatBRL(input.amount)}) é maior que o saldo em aberto (${formatBRL(open)}).`,
				)
			}

			const entry = await tx.billingPayment.create({
				data: {
					billing_id: billing.id,
					seller_id: billing.seller_id,
					kind: 'payment',
					amount: input.amount,
					method: input.method,
					paid_at: input.paidAt,
					note: input.note,
					created_by: input.createdBy,
				},
			})
			const paidAmount = await this.syncBilling(tx, billing)

			await appendDomainEvents(tx, [
				{
					sellerId: billing.seller_id,
					aggregateType: 'billing',
					aggregateId: billing.id,
					eventType: DOMAIN_EVENT_TYPES.BILLING_PAYMENT_RECORDED,
					payload: {
						billingId: billing.id,
						billingNumber: billing.billing_number,
						orderId: billing.order_id,
						paymentId: entry.id,
						amount: entry.amount,
						method: entry.method,
						paidAt: entry.paid_at.toISOString(),
						paidAmount,
						totalAmount: billing.total_amount,
					},
				},
			])
			if (idempotency) await completeIdempotencyKey(tx, idempotency, entry.id, 201)

			return { entry: toEntry(entry), replayed: false }
		})
	}

	async reverse(input: ReversePaymentInput): Promise<LedgerWriteResult> {
		return this.prisma.$transaction(async (tx) => {
			const idempotency = this.identity(input.idempotency)
			if (idempotency) {
				const claim = await claimIdempotencyKey(tx, idempotency, 'billing_payment')
				if (!claim.claimed) return this.replay(tx, claim.resourceId)
			}

			// The charge lock serialises reversals of the same payment, so the
			// "already reversed" check below can't race.
			const billing = await this.lockBilling(tx, input.billingId)
			const target = await tx.billingPayment.findFirst({
				where: { id: input.paymentId, billing_id: billing.id },
			})
			if (!target) throw new NotFoundException('Lançamento não encontrado')
			if (target.kind === 'reversal') {
				throw new BadRequestException('Um estorno não pode ser estornado.')
			}
			const already = await tx.billingPayment.findUnique({
				where: { reversal_of_id: target.id },
				select: { id: true },
			})
			if (already) {
				throw new ConflictException({
					message: 'Este pagamento já foi estornado.',
					error: 'Conflict',
					code: LEDGER_ERROR_CODES.alreadyReversed,
				})
			}

			const entry = await tx.billingPayment.create({
				data: {
					billing_id: billing.id,
					seller_id: billing.seller_id,
					kind: 'reversal',
					amount: target.amount,
					method: target.method,
					paid_at: new Date(),
					note: input.reason,
					created_by: input.createdBy,
					reversal_of_id: target.id,
				},
			})
			const paidAmount = await this.syncBilling(tx, billing)

			await appendDomainEvents(tx, [
				{
					sellerId: billing.seller_id,
					aggregateType: 'billing',
					aggregateId: billing.id,
					eventType: DOMAIN_EVENT_TYPES.BILLING_PAYMENT_REVERSED,
					payload: {
						billingId: billing.id,
						billingNumber: billing.billing_number,
						orderId: billing.order_id,
						reversalId: entry.id,
						paymentId: target.id,
						amount: entry.amount,
						paidAmount,
						totalAmount: billing.total_amount,
					},
				},
			])
			if (idempotency) await completeIdempotencyKey(tx, idempotency, entry.id, 201)

			return { entry: toEntry(entry), replayed: false }
		})
	}

	async list(billingId: number): Promise<BillingPaymentEntry[] | null> {
		const billing = await this.prisma.billing.findFirst({
			where: { id: billingId, ...this.tenantFilter() },
			select: { id: true },
		})
		if (!billing) return null
		const entries = await this.prisma.billingPayment.findMany({
			where: { billing_id: billingId },
			orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
		})
		return entries.map(toEntry)
	}

	private tenantFilter(): { seller_id?: string } {
		return this.tenantContext.isAdmin() ? {} : { seller_id: this.tenantContext.requireSellerId() }
	}

	private identity(request?: IdempotencyRequest) {
		return request ? { ...request, sellerId: this.tenantContext.requireSellerId() } : undefined
	}

	/** Same key + body already recorded this entry: hand it back without writing. */
	private async replay(tx: Tx, resourceId: string): Promise<LedgerWriteResult> {
		const entry = await tx.billingPayment.findUniqueOrThrow({ where: { id: Number(resourceId) } })
		return { entry: toEntry(entry), replayed: true }
	}

	/**
	 * Locks the charge row for the rest of the transaction. Another seller's charge
	 * is never locked nor revealed: it is simply not found (404).
	 */
	private async lockBilling(tx: Tx, billingId: number): Promise<LockedBilling> {
		const sellerId = this.tenantContext.isAdmin() ? null : this.tenantContext.requireSellerId()
		const [row] = await tx.$queryRaw<LockedBilling[]>`
			SELECT id, seller_id, order_id, billing_number, status::text AS status,
			       total_amount, paid_amount
			FROM billings
			WHERE id = ${billingId} AND (${sellerId}::text IS NULL OR seller_id = ${sellerId}::text)
			FOR UPDATE`
		if (!row) throw new NotFoundException('Cobrança não encontrada')
		return row
	}

	/**
	 * Recomputes the charge from its ledger: paid_amount = Σ payments − Σ reversals,
	 * payment_date = latest payment not reversed, payment_method = latest entry, and
	 * status derived from the amounts (a canceled charge stays canceled).
	 */
	private async syncBilling(tx: Tx, billing: LockedBilling): Promise<number> {
		const entries = await tx.billingPayment.findMany({ where: { billing_id: billing.id } })
		const summary = summarizeLedger(entries)
		await tx.billing.update({
			where: { id: billing.id },
			data: {
				paid_amount: summary.paidAmount,
				payment_date: summary.lastPaymentDate,
				...(summary.lastMethod ? { payment_method: summary.lastMethod as any } : {}),
				...(billing.status === 'canceled'
					? {}
					: (deriveBillingStatus(summary.paidAmount, billing.total_amount) as any)),
			},
		})
		return summary.paidAmount
	}
}

function toEntry(row: {
	id: number
	billing_id: number
	kind: string
	amount: number
	method: string
	paid_at: Date
	note: string | null
	created_by: string | null
	reversal_of_id: number | null
	created_at: Date
}): BillingPaymentEntry {
	return {
		id: row.id,
		billing_id: row.billing_id,
		kind: row.kind as BillingPaymentEntry['kind'],
		amount: row.amount,
		method: row.method as BillingPaymentEntry['method'],
		paid_at: row.paid_at,
		note: row.note,
		created_by: row.created_by,
		reversal_of_id: row.reversal_of_id,
		created_at: row.created_at,
	}
}
