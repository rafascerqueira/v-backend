import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import {
	BILLING_REPOSITORY,
	type BillingRepository,
} from '@/shared/repositories/billing.repository'
import { TenantContext } from '@/shared/tenant/tenant.context'
import type { CreateBillingDto } from '../dto/create-billing.dto'
import type { UpdateBillingDto } from '../dto/update-billing.dto'

@Injectable()
export class BillingsService {
	constructor(
		@Inject(BILLING_REPOSITORY) private readonly billingRepository: BillingRepository,
		private readonly tenantContext: TenantContext,
	) {}

	async findAll() {
		return this.billingRepository.findAll({})
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

		const { due_date, payment_date, ...rest } = dto
		return this.billingRepository.create({
			order_id: orderId,
			...rest,
			due_date: due_date ? new Date(due_date) : undefined,
			payment_date: payment_date ? new Date(payment_date) : undefined,
		})
	}

	async update(id: number, dto: UpdateBillingDto) {
		const billing = await this.billingRepository.findById(id)
		if (!billing) {
			throw new NotFoundException('Cobrança não encontrada')
		}
		if (
			!this.tenantContext.isAdmin() &&
			billing.order.seller_id !== this.tenantContext.getSellerId()
		) {
			throw new ForbiddenException('Acesso negado')
		}

		const { due_date, payment_date, ...rest } = dto
		return this.billingRepository.update(id, {
			...rest,
			due_date: due_date ? new Date(due_date) : due_date === null ? null : undefined,
			payment_date: payment_date
				? new Date(payment_date)
				: payment_date === null
					? null
					: undefined,
		})
	}
}
