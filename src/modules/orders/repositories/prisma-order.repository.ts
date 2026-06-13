import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
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
			// Lock stock rows to prevent concurrent overselling
			if (data.items.length > 0) {
				const productIds = data.items.map((i) => i.product_id)
				await tx.$queryRawUnsafe(
					`SELECT id FROM store_stock WHERE product_id = ANY($1::int[]) FOR UPDATE`,
					productIds,
				)
			}

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

			// Create the per_sale charge in the SAME transaction so an order is never
			// left without its billing record. Previously billing was a separate call
			// whose failure was swallowed as a warning, silently dropping the charge.
			if (data.billing) {
				await tx.billing.create({
					data: {
						order_id: order.id,
						billing_number: data.billing.billing_number,
						total_amount: data.billing.total_amount,
						paid_amount: data.billing.paid_amount,
						payment_method: data.billing.payment_method as any,
						payment_status: data.billing.payment_status as any,
						status: data.billing.status as any,
						due_date: data.billing.due_date,
					},
				})
			}

			return order as unknown as OrderWithRelations
		})
	}

	async addItem(data: CreateOrderItemData): Promise<OrderItem> {
		return this.prisma.$transaction(async (tx) => {
			// Verify order belongs to tenant
			const order = await tx.order.findUnique({ where: { id: data.order_id } })
			if (!order) throw new BadRequestException('Order not found')
			if (!this.tenantContext.isAdmin() && order.seller_id !== this.tenantContext.getSellerId()) {
				throw new BadRequestException('Order not found')
			}

			// Validate stock availability
			const stock = await tx.store_stock.findUnique({ where: { product_id: data.product_id } })
			if (stock) {
				const available = stock.quantity - stock.reserved_quantity
				if (available < data.quantity) {
					throw new BadRequestException(`Estoque insuficiente. Disponível: ${available}`)
				}
				// Decrement stock
				await tx.store_stock.update({
					where: { product_id: data.product_id },
					data: { quantity: { decrement: data.quantity } },
				})
				// Create movement record
				await tx.stock_movement.create({
					data: {
						movement_type: 'out',
						reference_type: 'sale',
						reference_id: order.id,
						product_id: data.product_id,
						quantity: data.quantity,
					},
				})
			}

			// Create item
			const item = await tx.order_item.create({
				data: {
					order_id: data.order_id,
					product_id: data.product_id,
					quantity: data.quantity,
					unit_price: data.unit_price,
					discount: data.discount,
					total: data.total,
				},
			})

			// Update order totals
			const allItems = await tx.order_item.findMany({ where: { order_id: data.order_id } })
			const subtotal = allItems.reduce((acc, it) => acc + it.total, 0)
			const discount = allItems.reduce((acc, it) => acc + it.discount, 0)
			await tx.order.update({
				where: { id: data.order_id },
				data: { subtotal, discount, total: subtotal - discount },
			})

			return item as unknown as OrderItem
		})
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
			const order = await this.requireOrderInTenant(tx, id)

			// Restore stock when an order moves INTO the canceled state. Idempotent:
			// skip if it was already canceled so a re-cancel can't double-restore.
			if (status === 'canceled' && order.status !== 'canceled') {
				await this.restoreStockInTx(tx, id)
			}

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
		return this.prisma.$transaction(async (tx) => {
			const order = await this.requireOrderInTenant(tx, id)

			// Only restore stock if it wasn't already returned by a prior cancellation —
			// otherwise deleting a canceled order would double-count stock.
			if (order.status !== 'canceled') {
				await this.restoreStockInTx(tx, id)
			}

			return tx.order.delete({ where: { id } }) as unknown as Order
		})
	}

	// Loads an order inside a transaction and enforces tenant ownership. Throws
	// NotFoundException (404) for both missing AND cross-tenant orders so existence
	// is never leaked to another seller. Mirrors the guard already used in addItem.
	private async requireOrderInTenant(tx: any, id: number): Promise<{ status: string }> {
		const order = await tx.order.findUnique({ where: { id } })
		if (
			!order ||
			(!this.tenantContext.isAdmin() && order.seller_id !== this.tenantContext.getSellerId())
		) {
			throw new NotFoundException('Order not found or access denied')
		}
		return order
	}

	// Returns every item's quantity to store_stock and records an `in`/`return`
	// movement. Shared by cancellation (updateStatus) and delete.
	private async restoreStockInTx(tx: any, orderId: number): Promise<void> {
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
	}
}
