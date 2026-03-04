import { BadRequestException, Injectable } from '@nestjs/common'
import { PrismaService } from '@/shared/prisma/prisma.service'
import type {
	CreateOrderData,
	CreateOrderItemData,
	Order,
	OrderItem,
	OrderRepository,
	OrderWithRelations,
} from '@/shared/repositories/order.repository'
import { TenantContext } from '@/shared/tenant/tenant.context'

@Injectable()
export class PrismaOrderRepository implements OrderRepository {
	constructor(
		private readonly prisma: PrismaService,
		private readonly tenantContext: TenantContext,
	) {}

	private getTenantFilter() {
		if (this.tenantContext.isAdmin()) {
			return {}
		}
		return { seller_id: this.tenantContext.requireSellerId() }
	}

	async create(data: CreateOrderData): Promise<OrderWithRelations> {
		return this.prisma.$transaction(async (tx) => {
			// Validate stock availability for items that have stock control
			for (const item of data.items) {
				const stock = await tx.store_stock.findUnique({
					where: { product_id: item.product_id },
				})
				// Only validate if stock record exists
				if (stock) {
					const available = stock.quantity - stock.reserved_quantity
					if (available < item.quantity) {
						const product = await tx.product.findUnique({
							where: { id: item.product_id },
						})
						throw new BadRequestException(
							`Estoque insuficiente para "${product?.name || item.product_id}". Disponível: ${available}, Solicitado: ${item.quantity}`,
						)
					}
				}
			}

			// Create order with items
			const order = await tx.order.create({
				data: {
					seller_id: data.seller_id,
					customer_id: data.customer_id,
					order_number: data.order_number,
					notes: data.notes,
					subtotal: data.subtotal,
					discount: data.discount,
					total: data.total,
					Order_item: {
						create: data.items.map((it) => ({
							product_id: it.product_id,
							quantity: it.quantity,
							unit_price: it.unit_price,
							discount: it.discount,
							total: it.total,
						})),
					},
				},
				include: { Order_item: true },
			})

			// Decrement stock and create movements only for items with stock control
			for (const item of data.items) {
				const stock = await tx.store_stock.findUnique({
					where: { product_id: item.product_id },
				})

				if (stock) {
					await tx.store_stock.update({
						where: { product_id: item.product_id },
						data: { quantity: { decrement: item.quantity } },
					})

					await tx.stock_movement.create({
						data: {
							movement_type: 'out',
							reference_type: 'sale',
							reference_id: order.id,
							product_id: item.product_id,
							quantity: item.quantity,
						},
					})
				}
			}

			return order as unknown as OrderWithRelations
		})
	}

	async addItem(data: CreateOrderItemData): Promise<OrderItem> {
		return this.prisma.order_item.create({
			data: {
				order_id: data.order_id,
				product_id: data.product_id,
				quantity: data.quantity,
				unit_price: data.unit_price,
				discount: data.discount,
				total: data.total,
			},
		}) as unknown as OrderItem
	}

	async findById(id: number): Promise<OrderWithRelations | null> {
		const order = await this.prisma.order.findUnique({
			where: { id },
			include: { Order_item: true, Billing: true, customer: true },
		})
		if (!order) return null
		if (!this.tenantContext.isAdmin() && order.seller_id !== this.tenantContext.getSellerId()) {
			return null
		}
		return order as unknown as OrderWithRelations
	}

	async findAll(filter: Record<string, unknown>): Promise<OrderWithRelations[]> {
		return this.prisma.order.findMany({
			where: { ...this.getTenantFilter(), ...filter },
			orderBy: { createdAt: 'desc' },
			include: {
				customer: {
					select: {
						id: true,
						name: true,
						email: true,
					},
				},
				Order_item: {
					include: {
						product: {
							select: {
								id: true,
								name: true,
							},
						},
					},
				},
			},
		}) as unknown as OrderWithRelations[]
	}

	async updateStatus(
		id: number,
		status: string,
		billingUpdate?: {
			status: string
			payment_status: string
			payment_date?: Date
			paid_amount?: number
		},
	): Promise<Order> {
		return this.prisma.$transaction(async (tx) => {
			const updatedOrder = await tx.order.update({
				where: { id },
				data: { status: status as any },
			})

			if (billingUpdate) {
				await tx.billing.updateMany({
					where: { order_id: id },
					data: {
						status: billingUpdate.status as any,
						payment_status: billingUpdate.payment_status as any,
						...(billingUpdate.payment_date
							? {
									payment_date: billingUpdate.payment_date,
									paid_amount: billingUpdate.paid_amount,
								}
							: {}),
					},
				})
			}

			return updatedOrder as unknown as Order
		})
	}

	async delete(id: number): Promise<Order> {
		return this.prisma.order.delete({
			where: { id },
		}) as unknown as Order
	}
}
