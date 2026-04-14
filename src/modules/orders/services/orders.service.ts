import { Inject, Injectable, Logger } from '@nestjs/common'
import { computeDueDate } from '@/shared/billing/billing-scheduler'
import { PrismaService } from '@/shared/prisma/prisma.service'
import {
	BILLING_REPOSITORY,
	type BillingRepository,
} from '@/shared/repositories/billing.repository'
import { ORDER_REPOSITORY, type OrderRepository } from '@/shared/repositories/order.repository'
import { TenantContext } from '@/shared/tenant/tenant.context'
import { CustomersService } from '../../customers/services/customers.service'
import type { CreateOrderDto, OrderItemInputDto } from '../dto/create-order.dto'

@Injectable()
export class OrdersService {
	private readonly logger = new Logger(OrdersService.name)

	constructor(
		@Inject(ORDER_REPOSITORY) private readonly orderRepository: OrderRepository,
		@Inject(BILLING_REPOSITORY) private readonly billingRepository: BillingRepository,
		private readonly tenantContext: TenantContext,
		private readonly prisma: PrismaService,
		private readonly customersService: CustomersService,
	) {}

	async create(dto: CreateOrderDto) {
		const { items, ...rest } = dto
		const sellerId = this.tenantContext.requireSellerId()

		const subtotal = items.reduce((acc, it) => acc + it.unit_price * it.quantity, 0)
		const discount = items.reduce((acc, it) => acc + it.discount, 0)
		const total = subtotal - discount

		const order = await this.orderRepository.create({
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

		await this.createBillingIfNeeded(order.id, rest.customer_id, rest.order_number, total)

		return order
	}

	private async createBillingIfNeeded(
		orderId: number,
		customerId: string,
		orderNumber: string,
		total: number,
	) {
		try {
			const customer = await this.customersService.findOne(customerId)
			// Only auto-create for per_sale; periodic modes are handled by the scheduled sync
			if (customer.billing_mode !== 'per_sale') return

			const billingNumber = orderNumber.replace(/^ORD/, 'COB') || `COB-${orderId}`
			const dueDate = computeDueDate(customer.billing_mode, customer.billing_day)

			await this.billingRepository.create({
				order_id: orderId,
				billing_number: billingNumber,
				total_amount: total,
				paid_amount: 0,
				payment_method: 'cash',
				payment_status: 'pending',
				status: 'pending',
				due_date: dueDate ?? undefined,
			})

			this.logger.log(`Cobrança ${billingNumber} criada automaticamente para pedido ${orderNumber}`)
		} catch (error) {
			this.logger.warn(`Falha ao criar cobrança automática para pedido ${orderNumber}: ${error}`)
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
		const order = await this.orderRepository.findById(id)
		if (!order) {
			throw new Error('Order not found or access denied')
		}

		// Restore stock on cancellation (only if not already canceled)
		if (status === 'canceled' && order.status !== 'canceled') {
			await this.restoreStock(id)
		}

		// Only propagate canceled status to billing — delivery does not mean payment
		const billingUpdate =
			status === 'canceled' ? { status: 'canceled', payment_status: 'canceled' } : undefined

		return this.orderRepository.updateStatus(id, status, billingUpdate)
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
