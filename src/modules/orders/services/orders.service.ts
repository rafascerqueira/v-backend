import { Inject, Injectable } from '@nestjs/common'
import { computeDueDate } from '@/shared/billing/billing-scheduler'
import {
	type CreateOrderBillingData,
	ORDER_REPOSITORY,
	type OrderRepository,
} from '@/shared/repositories/order.repository'
import { TenantContext } from '@/shared/tenant/tenant.context'
import { CustomersService } from '../../customers/services/customers.service'
import type { CreateOrderDto, OrderItemInputDto } from '../dto/create-order.dto'

@Injectable()
export class OrdersService {
	constructor(
		@Inject(ORDER_REPOSITORY) private readonly orderRepository: OrderRepository,
		private readonly tenantContext: TenantContext,
		private readonly customersService: CustomersService,
	) {}

	async create(dto: CreateOrderDto) {
		const { items, ...rest } = dto
		const sellerId = this.tenantContext.requireSellerId()

		const subtotal = items.reduce((acc, it) => acc + it.unit_price * it.quantity, 0)
		const discount = items.reduce((acc, it) => acc + it.discount, 0)
		const total = subtotal - discount

		// Compute the per_sale charge BEFORE the write so the repository can persist
		// it atomically with the order (replaces the old fire-and-forget call whose
		// failures were swallowed, leaving orders with no billing record).
		const billing = await this.buildBillingData(rest.customer_id, rest.order_number, total)

		return this.orderRepository.create({
			seller_id: sellerId,
			customer_id: rest.customer_id,
			order_number: rest.order_number,
			notes: rest.notes,
			subtotal,
			discount,
			total,
			items: items.map((it) => ({
				product_id: it.product_id,
				quantity: it.quantity,
				unit_price: it.unit_price,
				discount: it.discount,
				total: it.unit_price * it.quantity - it.discount,
			})),
			billing,
		})
	}

	// Returns the charge to persist alongside the order, or undefined when the
	// customer is not on per_sale billing (periodic modes are handled by the
	// scheduled sync). The customer lookup is a read, safe to run before the write.
	private async buildBillingData(
		customerId: string,
		orderNumber: string,
		total: number,
	): Promise<CreateOrderBillingData | undefined> {
		const customer = await this.customersService.findOne(customerId)
		if (customer.billing_mode !== 'per_sale') return undefined

		const dueDate = computeDueDate(customer.billing_mode, customer.billing_day)

		return {
			billing_number: orderNumber.replace(/^ORD/, 'COB'),
			total_amount: total,
			paid_amount: 0,
			payment_method: 'cash',
			payment_status: 'pending',
			status: 'pending',
			due_date: dueDate ?? undefined,
		}
	}

	async addItem(orderId: number, item: OrderItemInputDto) {
		const total = item.unit_price * item.quantity - (item.discount ?? 0)
		return this.orderRepository.addItem({
			order_id: orderId,
			product_id: item.product_id,
			quantity: item.quantity,
			unit_price: item.unit_price,
			discount: item.discount ?? 0,
			total,
		})
	}

	async findById(id: number) {
		return this.orderRepository.findById(id)
	}

	async findAll() {
		return this.orderRepository.findAll({})
	}

	async updateStatus(id: number, status: string) {
		// Propagate only cancellation to billing — delivery is not payment. Tenant
		// ownership, stock restoration and 404-on-missing are enforced in the repository.
		const billingUpdate =
			status === 'canceled' ? { status: 'canceled', payment_status: 'canceled' } : undefined

		return this.orderRepository.updateStatus(id, status, billingUpdate)
	}

	async delete(id: number) {
		return this.orderRepository.delete(id)
	}
}
