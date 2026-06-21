import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { computeDueDate } from '@/shared/billing/billing-scheduler'
import { deriveBillingStatus } from '@/shared/billing/billing-status'
import { RedisService } from '@/shared/redis/redis.service'
import {
	BILLING_REPOSITORY,
	type BillingRepository,
} from '@/shared/repositories/billing.repository'
import { TenantContext } from '@/shared/tenant/tenant.context'
import type { CreateBillingDto } from '../dto/create-billing.dto'
import type { UpdateBillingDto } from '../dto/update-billing.dto'

@Injectable()
export class BillingsService {
	private readonly logger = new Logger(BillingsService.name)

	constructor(
		@Inject(BILLING_REPOSITORY) private readonly billingRepository: BillingRepository,
		private readonly tenantContext: TenantContext,
		private readonly redis: RedisService,
	) {}

	async syncBillings(): Promise<{ created: number; orders: string[] }> {
		const unbilledOrders = await this.billingRepository.findUnbilledPerSaleOrders()
		const created: string[] = []

		for (const order of unbilledOrders) {
			try {
				const billingNumber = order.order_number.replace(/^ORD/, 'COB') || `COB-${order.id}`
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

		const { due_date, payment_date, ...rest } = dto
		// status/payment_status are derived from the amounts, never taken from the client.
		return this.billingRepository.create({
			order_id: orderId,
			...rest,
			...deriveBillingStatus(dto.paid_amount, dto.total_amount),
			due_date: due_date ? new Date(due_date) : undefined,
			payment_date: payment_date ? new Date(payment_date) : undefined,
		})
	}

	async update(id: number, dto: UpdateBillingDto) {
		// findById is tenant-scoped: a foreign or missing billing returns null → 404.
		// We deliberately don't 403 here (that would leak that the id exists).
		const billing = await this.billingRepository.findById(id)
		if (!billing) {
			throw new NotFoundException('Cobrança não encontrada')
		}

		const newTotal = dto.total_amount ?? billing.total_amount
		const newPaid = dto.paid_amount ?? billing.paid_amount

		if (newPaid > newTotal) {
			throw new BadRequestException('O valor pago não pode ser maior que o total da cobrança')
		}

		const { due_date, payment_date, ...rest } = dto

		// Auto-set payment_date when paid_amount is being recorded and no explicit date given
		let resolvedPaymentDate: Date | null | undefined
		if (payment_date !== undefined) {
			resolvedPaymentDate = payment_date ? new Date(payment_date) : null
		} else if (dto.paid_amount !== undefined && dto.paid_amount > 0 && !billing.payment_date) {
			resolvedPaymentDate = new Date()
		}

		// Re-derive status/payment_status from the resulting amounts, except for a
		// canceled billing: cancellation is a terminal state owned by order
		// cancellation, so editing amounts on it must not resurrect it as pending/paid.
		const derived = billing.status === 'canceled' ? {} : deriveBillingStatus(newPaid, newTotal)

		const result = await this.billingRepository.update(id, {
			...rest,
			...derived,
			due_date: due_date ? new Date(due_date) : due_date === null ? null : undefined,
			payment_date: resolvedPaymentDate,
		})

		const sellerId = this.tenantContext.getSellerId()
		if (sellerId) {
			await this.redis.delete(`dashboard:stats:${sellerId}`)
		}

		return result
	}

	/**
	 * Voids a charge. Cancellation is an explicit lifecycle action — not something
	 * derived from amounts — so it lives in its own method (and route) instead of the
	 * amount-driven update path. Sets the terminal canceled state, which update() then
	 * preserves on any later edit.
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

		const sellerId = this.tenantContext.getSellerId()
		if (sellerId) {
			await this.redis.delete(`dashboard:stats:${sellerId}`)
		}

		return result
	}

	async delete(id: number) {
		// Tenant-scoped findById → foreign/missing billing is a 404 (no 403 leak).
		const billing = await this.billingRepository.findById(id)
		if (!billing) {
			throw new NotFoundException('Cobrança não encontrada')
		}
		await this.billingRepository.delete(id)
	}
}
