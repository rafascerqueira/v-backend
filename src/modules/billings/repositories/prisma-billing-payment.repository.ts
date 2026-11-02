import {
	BadRequestException,
	ConflictException,
	Injectable,
	Logger,
	NotFoundException,
} from '@nestjs/common'
import type { PaymentMethod as DbPaymentMethod, Prisma } from '@/generated/prisma/client'
import { deriveBillingStatus } from '@/shared/billing/billing-status'
import { type LedgerEntryLike, summarizeLedger } from '@/shared/billing/ledger'
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
	OpenChargeInput,
	RecordPaymentInput,
	ReversePaymentInput,
	UpdateChargeInput,
	UpdateChargeResult,
} from '@/shared/repositories/billing-payment.repository'
import { TenantContext } from '@/shared/tenant/tenant.context'

export const LEDGER_ERROR_CODES = {
	alreadyReversed: 'ALREADY_REVERSED',
	drift: 'LEDGER_DRIFT',
} as const

/** Clock skew allowed for a client-sent paid_at; anything later is "in the future". */
const PAID_AT_FUTURE_TOLERANCE_MS = 5 * 60 * 1000
/** Nothing in this business predates it; older dates are typos (or 0000-…). */
const PAID_AT_FLOOR = new Date('2000-01-01T00:00:00Z')

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
	private readonly logger = new Logger(PrismaBillingPaymentRepository.name)

	constructor(
		private readonly prisma: PrismaService,
		private readonly tenantContext: TenantContext,
	) {}

	async record(input: RecordPaymentInput): Promise<LedgerWriteResult> {
		assertPaidAt(input.paidAt)
		return this.prisma.$transaction(async (tx) => {
			const idempotency = this.identity(input.idempotency)
			if (idempotency) {
				const claim = await claimIdempotencyKey(tx, idempotency, 'billing_payment')
				if (!claim.claimed) return this.replay(tx, claim.resourceId)
			}

			const billing = await this.lockBilling(tx, input.billingId)
			const entries = await this.ledgerOf(tx, billing)
			const entry = await this.appendPayment(tx, billing, entries, input)
			if (idempotency) await completeIdempotencyKey(tx, idempotency, entry.id, 201)
			return { entry: toEntry(entry), sellerId: billing.seller_id, replayed: false }
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
			const entries = await this.ledgerOf(tx, billing)
			const target = entries.find((e) => e.id === input.paymentId)
			if (!target) throw new NotFoundException('Lançamento não encontrado')
			if (target.kind === 'reversal') {
				throw new BadRequestException('Um estorno não pode ser estornado.')
			}
			if (entries.some((e) => e.reversal_of_id === target.id)) {
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
					method: target.method as DbPaymentMethod,
					paid_at: new Date(),
					note: input.reason,
					created_by: input.createdBy,
					reversal_of_id: target.id,
				},
			})
			const paidAmount = await this.syncBilling(tx, billing, billing.total_amount, [
				...entries,
				entry,
			])

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

			return { entry: toEntry(entry), sellerId: billing.seller_id, replayed: false }
		})
	}

	async updateCharge(input: UpdateChargeInput): Promise<UpdateChargeResult> {
		if (input.paidAt) assertPaidAt(input.paidAt)
		return this.prisma.$transaction(async (tx) => {
			// Everything is validated and derived from the LOCKED row: a concurrent
			// payment, cancellation or second save can't be undone by a stale read.
			const billing = await this.lockBilling(tx, input.billingId)
			const newTotal = input.totalAmount ?? billing.total_amount

			if (newTotal < billing.paid_amount) {
				throw new BadRequestException(
					'O total não pode ficar abaixo do valor já pago. Estorne um pagamento antes de reduzir o total.',
				)
			}
			// paid_amount (deprecated) is an absolute target: a retried save finds the
			// money already there (delta 0) instead of recording it twice.
			const delta =
				input.paidAmountTarget === undefined ? 0 : input.paidAmountTarget - billing.paid_amount
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

			await tx.billing.update({
				where: { id: billing.id },
				data: {
					...(input.totalAmount !== undefined ? { total_amount: input.totalAmount } : {}),
					...(input.paymentMethod ? { payment_method: input.paymentMethod } : {}),
					...(input.dueDate !== undefined ? { due_date: input.dueDate } : {}),
					...(input.notes !== undefined ? { notes: input.notes } : {}),
					// A canceled charge stays canceled (terminal state owned by cancellation).
					...(billing.status === 'canceled'
						? {}
						: (deriveBillingStatus(billing.paid_amount, newTotal) as any)),
				},
			})

			if (delta <= 0) return { recorded: null, sellerId: billing.seller_id }

			this.logger.warn(
				`[LEGACY_PAID_AMOUNT] PATCH /billings/${billing.id} raised paid_amount by ${delta}; recorded as a ledger payment`,
			)
			const updated = { ...billing, total_amount: newTotal }
			const entries = await this.ledgerOf(tx, updated)
			const entry = await this.appendPayment(tx, updated, entries, {
				amount: delta,
				method: input.paymentMethod ?? (input.fallbackMethod as RecordPaymentInput['method']),
				paidAt: input.paidAt ?? new Date(),
				note: input.legacyNote,
				createdBy: input.createdBy,
			})
			return { recorded: toEntry(entry), sellerId: billing.seller_id }
		})
	}

	async openCharge(input: OpenChargeInput): Promise<{ billingId: number; sellerId: string }> {
		if (input.initialPayment) assertPaidAt(input.initialPayment.paidAt)
		return this.prisma.$transaction(async (tx) => {
			// The charge belongs to its order's seller — derived here, never taken from
			// the caller (billing numbers are unique per seller).
			const order = await tx.order.findUnique({
				where: { id: input.orderId },
				select: { seller_id: true },
			})
			if (!order) throw new NotFoundException('Pedido não encontrado')

			const created = await tx.billing.create({
				data: {
					order_id: input.orderId,
					seller_id: order.seller_id,
					billing_number: input.billingNumber,
					total_amount: input.totalAmount,
					paid_amount: 0,
					payment_method: input.paymentMethod,
					...(deriveBillingStatus(0, input.totalAmount) as any),
					due_date: input.dueDate,
					notes: input.notes,
				},
			})

			// What was already paid becomes the first ledger entry, in the same
			// transaction: no unpaid orphan charge if it fails.
			if (input.initialPayment && input.initialPayment.amount > 0) {
				const billing: LockedBilling = {
					id: created.id,
					seller_id: created.seller_id,
					order_id: created.order_id,
					billing_number: created.billing_number,
					status: created.status,
					total_amount: created.total_amount,
					paid_amount: 0,
				}
				await this.appendPayment(tx, billing, [], {
					...input.initialPayment,
					method: input.paymentMethod,
				})
			}
			return { billingId: created.id, sellerId: created.seller_id }
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

	/** Validates against the locked charge, appends a payment, re-derives the charge. */
	private async appendPayment(
		tx: Tx,
		billing: LockedBilling,
		entries: LedgerEntryLike[],
		input: Pick<RecordPaymentInput, 'amount' | 'method' | 'paidAt' | 'note' | 'createdBy'>,
	) {
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
		const paidAmount = await this.syncBilling(tx, billing, billing.total_amount, [
			...entries,
			entry,
		])

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
		return entry
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
		return { entry: toEntry(entry), sellerId: entry.seller_id, replayed: true }
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
	 * The charge's entries, checked against its stored balance. They can only
	 * disagree if something wrote paid_amount outside the ledger (the database
	 * refuses that since the guard migration, so this means manual SQL): refuse and
	 * alert rather than silently recompute the balance and erase the difference.
	 */
	private async ledgerOf(tx: Tx, billing: LockedBilling): Promise<LedgerEntryLike[]> {
		const entries = await tx.billingPayment.findMany({ where: { billing_id: billing.id } })
		const ledgerBalance = summarizeLedger(entries).paidAmount
		if (ledgerBalance !== billing.paid_amount) {
			this.logger.error(
				`[LEDGER_DRIFT] billing ${billing.id}: paid_amount ${billing.paid_amount} != ledger ${ledgerBalance}`,
			)
			throw new ConflictException({
				message:
					'O saldo desta cobrança não confere com o histórico de pagamentos. Fale com o suporte antes de registrar novos pagamentos.',
				error: 'Conflict',
				code: LEDGER_ERROR_CODES.drift,
			})
		}
		return entries
	}

	/**
	 * Recomputes the charge from its ledger: paid_amount = Σ payments − Σ reversals,
	 * payment_date = latest payment not reversed, payment_method = latest entry, and
	 * status derived from the amounts (a canceled charge stays canceled). The
	 * `app.ledger_write` switch is what lets this write past the paid_amount guard.
	 */
	private async syncBilling(
		tx: Tx,
		billing: LockedBilling,
		totalAmount: number,
		entries: LedgerEntryLike[],
	): Promise<number> {
		const summary = summarizeLedger(entries)
		await tx.$queryRaw`SELECT set_config('app.ledger_write', 'on', true)`
		await tx.billing.update({
			where: { id: billing.id },
			data: {
				paid_amount: summary.paidAmount,
				payment_date: summary.lastPaymentDate,
				...(summary.lastMethod ? { payment_method: summary.lastMethod as any } : {}),
				...(billing.status === 'canceled'
					? {}
					: (deriveBillingStatus(summary.paidAmount, totalAmount) as any)),
			},
		})
		return summary.paidAmount
	}
}

function assertPaidAt(paidAt: Date): void {
	if (Number.isNaN(paidAt.getTime()) || paidAt < PAID_AT_FLOOR) {
		throw new BadRequestException('Data do pagamento inválida.')
	}
	if (paidAt.getTime() > Date.now() + PAID_AT_FUTURE_TOLERANCE_MS) {
		throw new BadRequestException('A data do pagamento não pode estar no futuro.')
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
