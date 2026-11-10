import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import type { Prisma } from '@/generated/prisma/client'
import { appendDomainEvents } from '@/shared/events/append-domain-events'
import { DOMAIN_EVENT_TYPES } from '@/shared/events/domain-event.types'
import { PrismaService } from '@/shared/prisma/prisma.service'
import { LOCKING_TRANSACTION } from '@/shared/prisma/transaction-options'
import type {
	CreateStockMovementData,
	CreateStockMovementResult,
	FulfilledBackorderInfo,
	StockMovement,
	StockMovementRepository,
} from '@/shared/repositories/stock-movement.repository'
import { TenantContext } from '@/shared/tenant/tenant.context'

type Tx = Prisma.TransactionClient

interface StockedProduct {
	id: number
	name: string
	seller_id: string
}

interface LockedStock {
	quantity: number
	reserved_quantity: number
}

@Injectable()
export class PrismaStockMovementRepository implements StockMovementRepository {
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

	async findByProduct(productId: number): Promise<StockMovement[]> {
		// Verify product belongs to tenant
		const product = await this.prisma.product.findFirst({
			where: { id: productId, ...this.getTenantFilter() },
		})
		if (!product) return []

		return this.prisma.stock_movement.findMany({
			where: { product_id: productId },
			orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
		}) as unknown as StockMovement[]
	}

	async create(data: CreateStockMovementData): Promise<CreateStockMovementResult> {
		return this.prisma.$transaction(async (tx) => {
			const product = await this.findProduct(tx, data.product_id)
			if (!product) throw new BadRequestException('Product not found')

			const current = await this.lockStock(tx, data.product_id)
			const currentQty = current?.quantity ?? 0
			// Only block an `out` movement from removing more than is on hand. An `in`
			// movement only raises stock, so it must never be blocked — in particular a
			// restock that merely reduces an oversold deficit (e.g. -3 → -1) is valid and
			// gets allocated to pending backorders.
			if (data.movement_type === 'out' && currentQty - data.quantity < 0) {
				throw new BadRequestException('Insufficient stock')
			}
			return this.applyMovement(tx, product, current, data)
		}, LOCKING_TRANSACTION)
	}

	async adjustTo(productId: number, target: number): Promise<CreateStockMovementResult | null> {
		return this.prisma.$transaction(async (tx) => {
			const product = await this.findProduct(tx, productId)
			if (!product) throw new NotFoundException('Product not found')

			// The difference is computed under the lock: a sale or restock landing
			// meanwhile can't make "set to N" end anywhere but N.
			const current = await this.lockStock(tx, productId)
			const delta = target - (current?.quantity ?? 0)
			if (delta === 0) return null

			// A count correction is the seller's call: it may take stock to any value.
			return this.applyMovement(tx, product, current, {
				movement_type: delta > 0 ? 'in' : 'out',
				reference_type: 'adjustment',
				reference_id: productId,
				product_id: productId,
				quantity: Math.abs(delta),
			})
		}, LOCKING_TRANSACTION)
	}

	private findProduct(tx: Tx, productId: number): Promise<StockedProduct | null> {
		return tx.product.findFirst({
			where: { id: productId, ...this.getTenantFilter() },
			select: { id: true, name: true, seller_id: true },
		})
	}

	/** Locks the product's stock row for the rest of the transaction (none yet → null). */
	private async lockStock(tx: Tx, productId: number): Promise<LockedStock | null> {
		const [row] = await tx.$queryRaw<LockedStock[]>`
			SELECT quantity, reserved_quantity FROM store_stock
			WHERE product_id = ${productId}
			FOR UPDATE`
		return row ?? null
	}

	/**
	 * Applies a movement to the locked row with an atomic increment/decrement (never
	 * an absolute write), records it, allocates an arrival to pending backorders and
	 * appends stock.moved — all in the caller's transaction.
	 */
	private async applyMovement(
		tx: Tx,
		product: StockedProduct,
		current: LockedStock | null,
		data: CreateStockMovementData,
	): Promise<CreateStockMovementResult> {
		const currentQty = current?.quantity ?? 0
		const reserved = current?.reserved_quantity ?? 0
		const delta = data.movement_type === 'in' ? data.quantity : -data.quantity
		const nextQty = currentQty + delta

		await tx.store_stock.upsert({
			where: { product_id: data.product_id },
			create: {
				seller_id: product.seller_id,
				product_id: data.product_id,
				quantity: nextQty,
				reserved_quantity: reserved,
				min_stock: 0,
				max_stock: 0,
			},
			update: { quantity: { increment: delta } },
		})

		const movement = await tx.stock_movement.create({
			data: {
				movement_type: data.movement_type as any,
				reference_type: data.reference_type as any,
				reference_id: data.reference_id,
				product_id: data.product_id,
				quantity: data.quantity,
			},
		})

		// An incoming arrival covers part/all of the deficit — allocate it to the
		// product's pending backorders FIFO so the seller can finalize those orders.
		const fulfilled =
			data.movement_type === 'in'
				? await this.allocateBackorders(tx, product, currentQty, nextQty, reserved)
				: []

		await appendDomainEvents(tx, [
			{
				sellerId: product.seller_id,
				aggregateType: 'stock',
				aggregateId: product.id,
				eventType: DOMAIN_EVENT_TYPES.STOCK_MOVED,
				payload: {
					productId: product.id,
					productName: product.name,
					movementId: movement.id,
					movementType: data.movement_type,
					referenceType: data.reference_type,
					quantity: data.quantity,
					previousQuantity: currentQty,
					newQuantity: nextQty,
					fulfilled: fulfilled.map((f) => ({
						orderId: f.order_id,
						orderNumber: f.order_number,
						quantity: f.quantity,
					})),
				},
			},
		])

		return { movement: movement as unknown as StockMovement, fulfilled }
	}

	// Distributes the units this arrival just covered across the product's pending
	// backorders, oldest first. The number now covered is the drop in the deficit
	// (owed = max(reserved - quantity, 0)); a row is marked `fulfilled` once its full
	// owed quantity is met. Returns the orders that became fully covered.
	private async allocateBackorders(
		tx: Tx,
		product: StockedProduct,
		prevQty: number,
		nextQty: number,
		reserved: number,
	): Promise<FulfilledBackorderInfo[]> {
		const productId = product.id
		const owedBefore = Math.max(reserved - prevQty, 0)
		const owedAfter = Math.max(reserved - nextQty, 0)
		let toAllocate = owedBefore - owedAfter
		if (toAllocate <= 0) return []

		const pending = await tx.backorder.findMany({
			where: { product_id: productId, status: 'pending' },
			orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
		})

		const fulfilled: FulfilledBackorderInfo[] = []
		for (const bo of pending) {
			if (toAllocate <= 0) break
			const remaining = bo.quantity - bo.fulfilled_quantity
			const take = Math.min(remaining, toAllocate)
			if (take <= 0) continue

			const newFulfilled = bo.fulfilled_quantity + take
			const fullyCovered = newFulfilled >= bo.quantity
			await tx.backorder.update({
				where: { id: bo.id },
				data: {
					fulfilled_quantity: newFulfilled,
					...(fullyCovered ? { status: 'fulfilled', fulfilledAt: new Date() } : {}),
				},
			})
			toAllocate -= take

			// Only notify once an order is fully covered (ready to finalize).
			if (fullyCovered) {
				const order = await tx.order.findUnique({
					where: { id: bo.order_id },
					select: { order_number: true },
				})
				fulfilled.push({
					seller_id: product.seller_id,
					order_id: bo.order_id,
					order_number: order?.order_number ?? String(bo.order_id),
					product_id: productId,
					product_name: product.name,
					quantity: bo.quantity,
				})
			}
		}

		return fulfilled
	}
}
