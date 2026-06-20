import { Inject, Injectable } from '@nestjs/common'
import { computeDueDate } from '@/shared/billing/billing-scheduler'
import { deriveBillingStatus } from '@/shared/billing/billing-status'
import { QueueProducer } from '@/shared/queue/queue.producer'
import {
	type CreateOrderBillingData,
	ORDER_REPOSITORY,
	type OrderRepository,
	type OversoldItem,
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
		private readonly queueProducer: QueueProducer,
	) {}

	async create(dto: CreateOrderDto) {
		const { items, ...rest } = dto
		const sellerId = this.tenantContext.requireSellerId()

		// A line's discount is client-supplied and only validated as nonnegative, so
		// clamp it to the line value (unit_price * quantity). This keeps every line
		// total >= 0 and, since order.discount is the sum of these, the order total
		// can never go negative. The clamped discount is what we persist so the stored
		// discount and total stay consistent.
		const pricedItems = items.map((it) => {
			const lineValue = it.unit_price * it.quantity
			const discount = Math.min(it.discount, lineValue)
			return {
				product_id: it.product_id,
				quantity: it.quantity,
				unit_price: it.unit_price,
				discount,
				total: lineValue - discount,
				lineValue,
			}
		})

		const subtotal = pricedItems.reduce((acc, it) => acc + it.lineValue, 0)
		const discount = pricedItems.reduce((acc, it) => acc + it.discount, 0)
		const total = subtotal - discount

		// Compute the per_sale charge BEFORE the write so the repository can persist
		// it atomically with the order (replaces the old fire-and-forget call whose
		// failures were swallowed, leaving orders with no billing record).
		const billing = await this.buildBillingData(rest.customer_id, rest.order_number, total)

		const { order, oversold } = await this.orderRepository.create({
			seller_id: sellerId,
			customer_id: rest.customer_id,
			order_number: rest.order_number,
			notes: rest.notes,
			subtotal,
			discount,
			total,
			items: pricedItems.map(({ lineValue: _lineValue, ...it }) => it),
			billing,
		})

		// Out-of-stock items were sold anyway (allow_oversell). Warn the seller that
		// these units are pending delivery — done after the commit so it never fires
		// on a rolled-back order, and enqueued (not sent inline) per side-effect rules.
		await this.notifyOversold(sellerId, rest.order_number, oversold)

		return order
	}

	private async notifyOversold(
		sellerId: string,
		orderNumber: string,
		oversold: OversoldItem[],
	): Promise<void> {
		for (const item of oversold) {
			await this.queueProducer.createNotification({
				userId: sellerId,
				type: 'warning',
				title: 'Venda sem estoque',
				message: `"${item.product_name}" foi vendido sem estoque no pedido ${orderNumber} (disponível: ${item.available}, vendido: ${item.requested}). Entrega pendente.`,
				data: {
					orderNumber,
					productId: item.product_id,
					available: item.available,
					requested: item.requested,
				},
				sendEmail: true,
			})
		}
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
			...deriveBillingStatus(0, total),
			due_date: dueDate ?? undefined,
		}
	}

	async addItem(orderId: number, item: OrderItemInputDto) {
		// Clamp the line discount to the line value so the item total can't go
		// negative (mirrors the rule in create). The repo recomputes the order
		// totals from the persisted items, so a clamped discount keeps them consistent.
		const lineValue = item.unit_price * item.quantity
		const discount = Math.min(item.discount ?? 0, lineValue)
		return this.orderRepository.addItem({
			order_id: orderId,
			product_id: item.product_id,
			quantity: item.quantity,
			unit_price: item.unit_price,
			discount,
			total: lineValue - discount,
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
