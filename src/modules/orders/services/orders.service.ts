import { Inject, Injectable } from '@nestjs/common'
import { ORDER_REPOSITORY, type OrderRepository } from '@/shared/repositories/order.repository'
import { TenantContext } from '@/shared/tenant/tenant.context'
import type { CreateOrderDto, OrderItemInputDto } from '../dto/create-order.dto'

@Injectable()
export class OrdersService {
	constructor(
		@Inject(ORDER_REPOSITORY) private readonly orderRepository: OrderRepository,
		private readonly tenantContext: TenantContext,
	) {}

	async create(dto: CreateOrderDto) {
		const { items, ...rest } = dto
		const sellerId = this.tenantContext.requireSellerId()

		const subtotal = items.reduce((acc, it) => acc + it.unit_price * it.quantity, 0)
		const discount = items.reduce((acc, it) => acc + it.discount, 0)
		const total = subtotal - discount

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
		})
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
		const order = await this.orderRepository.findById(id)
		if (!order) {
			throw new Error('Order not found or access denied')
		}

		// Map order status to billing status
		const billingStatusMap: Record<string, { status: string; payment_status: string } | null> = {
			pending: { status: 'pending', payment_status: 'pending' },
			confirmed: { status: 'pending', payment_status: 'pending' },
			shipping: { status: 'pending', payment_status: 'pending' },
			delivered: { status: 'paid', payment_status: 'confirmed' },
			canceled: { status: 'canceled', payment_status: 'canceled' },
		}

		const billingUpdate = billingStatusMap[status]

		return this.orderRepository.updateStatus(
			id,
			status,
			billingUpdate
				? {
						...billingUpdate,
						...(status === 'delivered'
							? {
									payment_date: new Date(),
									paid_amount: order.total,
								}
							: {}),
					}
				: undefined,
		)
	}

	async delete(id: number) {
		const order = await this.orderRepository.findById(id)
		if (!order) {
			throw new Error('Order not found or access denied')
		}
		return this.orderRepository.delete(id)
	}
}
