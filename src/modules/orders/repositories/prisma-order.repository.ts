import {
	BadRequestException,
	ConflictException,
	Injectable,
	NotFoundException,
} from '@nestjs/common'
import type { Prisma } from '@/generated/prisma/client'
import { appendDomainEvents } from '@/shared/events/append-domain-events'
import { DOMAIN_EVENT_TYPES } from '@/shared/events/domain-event.types'
import { claimIdempotencyKey, completeIdempotencyKey } from '@/shared/idempotency/idempotency'
import { PrismaService } from '@/shared/prisma/prisma.service'
import type {
	CreateOrderData,
	CreateOrderItemData,
	CreateOrderResult,
	Order,
	OrderEvent,
	OrderItem,
	OrderRepository,
	OrderWithRelations,
	OversoldItem,
} from '@/shared/repositories/order.repository'
import { nextSellerSequenceValue } from '@/shared/sequences/seller-sequence'
import { TenantContext } from '@/shared/tenant/tenant.context'
import { billingNumberFor, orderNumberFor } from '../order-numbering'

export const ORDER_ERROR_CODES = {
	hasPayments: 'HAS_PAYMENTS',
} as const

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

	/**
	 * The single write path for every order (dashboard and storefront), in one
	 * transaction: Idempotency-Key claim → product ownership + stock lock/check →
	 * sequence number → order + items → backorders → stock movements → per-sale charge
	 * → order.created event → key completion. Side effects run later from the event.
	 */
	async create(data: CreateOrderData): Promise<CreateOrderResult> {
		return this.prisma.$transaction(async (tx) => {
			// FIRST statement on purpose: a concurrent repeat blocks here, before taking
			// any stock lock, so repeats can't deadlock with the request they repeat.
			const idempotency = data.idempotency
				? { ...data.idempotency, sellerId: data.seller_id }
				: undefined
			if (idempotency) {
				const claim = await claimIdempotencyKey(tx, idempotency, 'order')
				if (!claim.claimed) return { orderId: Number(claim.resourceId), replayed: true }
			}

			// Stock rows of the ordered products (absent = not stock-tracked).
			const stockByProduct = new Map<number, { quantity: number; reserved_quantity: number }>()

			// Lock stock rows to prevent concurrent overselling
			if (data.items.length > 0) {
				const productIds = data.items.map((i) => i.product_id)

				// Every referenced product must belong to the order's seller. Without
				// this, a seller could place an order with another tenant's product_id
				// and decrement that tenant's stock (the FOR UPDATE / decrement /
				// stock_movement below all key off product_id alone).
				const uniqueIds = [...new Set(productIds)]
				const ownedCount = await tx.product.count({
					where: { id: { in: uniqueIds }, seller_id: data.seller_id },
				})
				if (ownedCount !== uniqueIds.length) {
					throw new NotFoundException('Um ou mais produtos não foram encontrados')
				}

				await tx.$queryRawUnsafe(
					`SELECT id FROM store_stock WHERE product_id = ANY($1::int[]) FOR UPDATE`,
					productIds,
				)
				// One read for every line (not one per line): the rows are locked above.
				const rows = await tx.store_stock.findMany({ where: { product_id: { in: uniqueIds } } })
				for (const row of rows) stockByProduct.set(row.product_id, row)
			}

			// Items sold past their stock via allow_oversell — reported back so the
			// service can notify the seller, and recorded as backorders below.
			const oversold: OversoldItem[] = []
			// Units newly owed per line (parallel to data.items); turned into backorder
			// rows once the order items have ids. Zero for in-stock lines.
			const owedByIndex: number[] = new Array(data.items.length).fill(0)
			// Running available-per-product so multiple lines of the same product each
			// see the stock earlier lines already consumed — otherwise the owed total
			// (and the negative the stock lands on) would disagree.
			const runningAvailable = new Map<number, number>()

			// Validate stock availability for items that have stock control
			for (let i = 0; i < data.items.length; i++) {
				const item = data.items[i]
				const stock = stockByProduct.get(item.product_id)
				// Only items with a stock record participate in oversell/backorders.
				if (!stock) continue

				if (!runningAvailable.has(item.product_id)) {
					runningAvailable.set(item.product_id, stock.quantity - stock.reserved_quantity)
				}
				const available = runningAvailable.get(item.product_id) ?? 0

				if (available < item.quantity) {
					const product = await tx.product.findUnique({
						where: { id: item.product_id },
					})
					// Products flagged allow_oversell sell past their stock; the
					// decrement below simply takes the quantity negative. Anything
					// else is a hard stop — and always on the storefront, where
					// overselling is not the customer's call.
					if (!data.allowOversell || !product?.allow_oversell) {
						throw new BadRequestException(
							`Estoque insuficiente para "${product?.name || item.product_id}". Disponível: ${Math.max(available, 0)}, Solicitado: ${item.quantity}`,
						)
					}
					// Only the part beyond what's on hand is owed (clamp at 0 so an
					// already-negative stock doesn't re-count the prior deficit).
					owedByIndex[i] = item.quantity - Math.max(available, 0)
					oversold.push({
						product_id: item.product_id,
						product_name: product?.name ?? String(item.product_id),
						available,
						requested: item.quantity,
					})
				}

				runningAvailable.set(item.product_id, available - item.quantity)
			}

			// Numbered by the server. Taken after the stock checks because the counter row
			// stays locked until commit (it serialises this seller's order creation); a
			// rollback hands the number back, so numbers stay contiguous.
			let sequence = await nextSellerSequenceValue(tx, data.seller_id, 'order')
			// The migration seeds the counter past every number it saw, but a number
			// typed by hand afterwards (old client during the deploy window) could
			// still be taken. Skip it instead of failing every later order of the seller.
			while (
				await tx.order.findFirst({
					where: { seller_id: data.seller_id, order_number: orderNumberFor(sequence) },
					select: { id: true },
				})
			) {
				sequence = await nextSellerSequenceValue(tx, data.seller_id, 'order')
			}
			const orderNumber = orderNumberFor(sequence)

			// Create order with items
			const order = await tx.order.create({
				data: {
					seller_id: data.seller_id,
					customer_id: data.customer_id,
					order_number: orderNumber,
					notes: data.notes,
					subtotal: data.subtotal,
					discount: data.discount,
					total: data.total,
					metadata: data.metadata as Prisma.InputJsonValue | undefined,
					tracking_token: data.tracking_token,
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

			// Record owed units as backorders, one per oversold line, so the order-level
			// "aguardando reposição" detail survives and a restock can be allocated to it.
			// Order_item ids come back in creation (id-ascending) order, matching the
			// data.items order owedByIndex was computed against.
			const createdItems = [...order.Order_item].sort((a, b) => a.id - b.id)
			for (let i = 0; i < owedByIndex.length; i++) {
				const owed = owedByIndex[i]
				const createdItem = createdItems[i]
				if (owed <= 0 || !createdItem) continue
				await tx.backorder.create({
					data: {
						seller_id: data.seller_id,
						order_id: order.id,
						order_item_id: createdItem.id,
						product_id: data.items[i].product_id,
						quantity: owed,
					},
				})
			}

			// Decrement stock and create movements only for items with stock control
			for (const item of data.items) {
				if (stockByProduct.has(item.product_id)) {
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
				const billing = {
					order_id: order.id,
					seller_id: data.seller_id,
					total_amount: data.billing.total_amount,
					paid_amount: data.billing.paid_amount,
					payment_method: data.billing.payment_method as any,
					payment_status: data.billing.payment_status as any,
					status: data.billing.status as any,
					due_date: data.billing.due_date,
				}
				// COB-n mirrors PED-n. A charge typed by hand may already hold that number
				// (billing numbers are free text on POST /orders/:id/billings): ON CONFLICT
				// DO NOTHING keeps the transaction alive, and the order id disambiguates.
				const { count } = await tx.billing.createMany({
					data: [{ ...billing, billing_number: billingNumberFor(sequence) }],
					skipDuplicates: true,
				})
				if (count === 0) {
					await tx.billing.create({
						data: { ...billing, billing_number: `${billingNumberFor(sequence)}-${order.id}` },
					})
				}
			}

			await appendDomainEvents(tx, [
				{
					sellerId: data.seller_id,
					aggregateType: 'order',
					aggregateId: order.id,
					eventType: DOMAIN_EVENT_TYPES.ORDER_CREATED,
					payload: orderCreatedPayload(order.id, orderNumber, data, oversold),
				},
			])

			if (idempotency) await completeIdempotencyKey(tx, idempotency, order.id, 201)

			return { orderId: order.id, replayed: false }
		})
	}

	async findEvents(orderId: number): Promise<OrderEvent[] | null> {
		const order = await this.prisma.order.findUnique({
			where: { id: orderId },
			select: { seller_id: true },
		})
		if (
			!order ||
			(!this.tenantContext.isAdmin() && order.seller_id !== this.tenantContext.getSellerId())
		) {
			return null
		}
		const events = await this.prisma.domainEvent.findMany({
			where: { seller_id: order.seller_id, aggregate_type: 'order', aggregate_id: String(orderId) },
			orderBy: { occurred_at: 'asc' },
			select: { id: true, event_type: true, occurred_at: true, payload: true },
		})
		return events.map((event) => ({
			...event,
			payload: (event.payload ?? {}) as Record<string, unknown>,
		}))
	}

	async addItem(data: CreateOrderItemData): Promise<OrderItem> {
		return this.prisma.$transaction(async (tx) => {
			// Verify order belongs to tenant
			const order = await tx.order.findUnique({ where: { id: data.order_id } })
			if (!order) throw new BadRequestException('Order not found')
			if (!this.tenantContext.isAdmin() && order.seller_id !== this.tenantContext.getSellerId()) {
				throw new BadRequestException('Order not found')
			}

			// The item's product must belong to the same seller as the order —
			// otherwise the stock decrement below would hit another tenant's product.
			const ownedProduct = await tx.product.findFirst({
				where: { id: data.product_id, seller_id: order.seller_id },
				select: { id: true },
			})
			if (!ownedProduct) throw new NotFoundException('Produto não encontrado')

			// Validate stock availability
			let owed = 0
			const stock = await tx.store_stock.findUnique({ where: { product_id: data.product_id } })
			if (stock) {
				const available = stock.quantity - stock.reserved_quantity
				if (available < data.quantity) {
					const product = await tx.product.findUnique({ where: { id: data.product_id } })
					// allow_oversell products bypass the shortage block; stock goes negative.
					if (!product?.allow_oversell) {
						throw new BadRequestException(`Estoque insuficiente. Disponível: ${available}`)
					}
					owed = data.quantity - Math.max(available, 0)
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

			// Record the owed units as a backorder for this new line (mirrors create()).
			if (owed > 0) {
				await tx.backorder.create({
					data: {
						seller_id: order.seller_id,
						order_id: order.id,
						order_item_id: item.id,
						product_id: data.product_id,
						quantity: owed,
					},
				})
			}

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
			include: {
				Order_item: {
					include: { product: { select: { id: true, name: true } }, backorder: true },
				},
				Billing: true,
				// Contact fields only — never the whole row (document, address, hash).
				customer: { select: { id: true, name: true, email: true, phone: true } },
			},
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
						backorder: true,
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

			if (order.status !== status) {
				await appendDomainEvents(tx, [
					{
						sellerId: order.seller_id,
						aggregateType: 'order',
						aggregateId: id,
						eventType: DOMAIN_EVENT_TYPES.ORDER_STATUS_CHANGED,
						payload: {
							orderId: id,
							orderNumber: order.order_number,
							from: order.status,
							to: status,
						},
					},
				])
			}

			if (billingUpdate) {
				await tx.billing.updateMany({
					where: { order_id: id },
					data: {
						status: billingUpdate.status as any,
						payment_status: billingUpdate.payment_status as any,
					},
				})
			}

			return updatedOrder as unknown as Order
		})
	}

	async delete(id: number): Promise<Order> {
		return this.prisma.$transaction(async (tx) => {
			const order = await this.requireOrderInTenant(tx, id)

			// Financial history is never erased (D2): an order whose charge has ledger
			// entries (even fully reversed ones) is canceled, not deleted. Locked so a
			// payment recorded concurrently can't slip in between this check and the
			// cascade delete below (the ledger FK is the DB backstop).
			const charges: { paid_amount: number; has_entries: boolean }[] = await tx.$queryRaw`
				SELECT b.paid_amount,
				       EXISTS (SELECT 1 FROM billing_payments p WHERE p.billing_id = b.id) AS has_entries
				FROM billings b WHERE b.order_id = ${id} FOR UPDATE OF b`
			if (charges.some((charge) => charge.has_entries || Number(charge.paid_amount) > 0)) {
				throw new ConflictException({
					message:
						'Este pedido tem pagamento registrado e não pode ser excluído. Cancele o pedido em vez de excluí-lo.',
					error: 'Conflict',
					code: ORDER_ERROR_CODES.hasPayments,
				})
			}

			// Only restore stock if it wasn't already returned by a prior cancellation —
			// otherwise deleting a canceled order would double-count stock.
			if (order.status !== 'canceled') {
				await this.restoreStockInTx(tx, id)
			}

			await appendDomainEvents(tx, [
				{
					sellerId: order.seller_id,
					aggregateType: 'order',
					aggregateId: id,
					eventType: DOMAIN_EVENT_TYPES.ORDER_DELETED,
					payload: { orderId: id, orderNumber: order.order_number, status: order.status },
				},
			])

			return tx.order.delete({ where: { id } }) as unknown as Order
		})
	}

	// Loads an order inside a transaction and enforces tenant ownership. Throws
	// NotFoundException (404) for both missing AND cross-tenant orders so existence
	// is never leaked to another seller. Mirrors the guard already used in addItem.
	private async requireOrderInTenant(
		tx: any,
		id: number,
	): Promise<{ status: string; seller_id: string; order_number: string }> {
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
		// Cancel any units this order still owes — canceling/deleting it drops the
		// obligation, and the full-quantity restore below already brings the negative
		// stock back to baseline. (Known limitation: a partially-fulfilled backorder
		// over-restores by the already-fulfilled amount — deferred per plan.)
		await tx.backorder.updateMany({
			where: { order_id: orderId, status: 'pending' },
			data: { status: 'canceled' },
		})

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

/**
 * order.created payload: ids, numbers, quantities and cents only (no customer PII).
 * Product names are snapshotted for the "Venda sem estoque" notification text.
 */
function orderCreatedPayload(
	orderId: number,
	orderNumber: string,
	data: CreateOrderData,
	oversold: OversoldItem[],
): Record<string, unknown> {
	return {
		orderId,
		orderNumber,
		source: data.source,
		customerId: data.customer_id,
		total: data.total,
		itemCount: data.items.length,
		oversold: oversold.map((item) => ({
			productId: item.product_id,
			productName: item.product_name,
			available: item.available,
			requested: item.requested,
		})),
	}
}
