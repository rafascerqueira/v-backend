import { Inject, Injectable } from '@nestjs/common'
import { PrismaService } from '@/shared/prisma/prisma.service'
import { ORDER_REPOSITORY, type OrderRepository } from '@/shared/repositories/order.repository'
import { TenantContext } from '@/shared/tenant/tenant.context'
import type { CreateOrderDto, OrderItemInputDto } from '../dto/create-order.dto'

@Injectable()
export class OrdersService {
	constructor(
		@Inject(ORDER_REPOSITORY) private readonly orderRepository: OrderRepository,
		private readonly tenantContext: TenantContext,
		private readonly prisma: PrismaService,
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

		// Restore stock on cancellation (only if not already canceled)
		if (status === 'canceled' && order.status !== 'canceled') {
			await this.restoreStock(id)
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

	private async restoreStock(orderId: number) {
		await this.prisma.$transaction(async (tx) => {
			const items = await tx.order_item.findMany({ where: { order_id: orderId } })

			for (const item of items) {
				const stock = await tx.store_stock.findUnique({
					where: { product_id: item.product_id },
				})
				if (stock) {
					await tx.store_stock.update({
						where: { product_id: item.product_id },
						data: { quantity: { increment: item.quantity } },
					})
					await tx.stock_movement.create({
						data: {
							movement_type: 'in',
							reference_type: 'return',
							reference_id: orderId,
							product_id: item.product_id,
							quantity: item.quantity,
						},
					})
				}
			}
		})
	}

	async delete(id: number) {
		const order = await this.orderRepository.findById(id)
		if (!order) {
			throw new Error('Order not found or access denied')
		}
		return this.orderRepository.delete(id)
	}
}
