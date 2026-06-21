import { BadRequestException, Injectable } from '@nestjs/common'
import { PrismaService } from '@/shared/prisma/prisma.service'
import type {
	CreateStockMovementData,
	CreateStockMovementResult,
	FulfilledBackorderInfo,
	StockMovement,
	StockMovementRepository,
} from '@/shared/repositories/stock-movement.repository'
import { TenantContext } from '@/shared/tenant/tenant.context'

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
		const { movement_type, product_id, quantity } = data

		return this.prisma.$transaction(async (tx) => {
			// Ensure product exists and belongs to tenant
			const product = await tx.product.findFirst({
				where: { id: product_id, ...this.getTenantFilter() },
			})
			if (!product) throw new BadRequestException('Product not found')

			// Current stock
			const current = await tx.store_stock.findUnique({
				where: { product_id },
			})
			const currentQty = current?.quantity ?? 0
			const reserved = current?.reserved_quantity ?? 0

			const delta = movement_type === 'in' ? quantity : -quantity
			const nextQty = currentQty + delta
			// Only block an `out` adjustment from removing more than is on hand. An `in`
			// movement only raises stock, so it must never be blocked — in particular a
			// restock that merely reduces an oversold deficit (e.g. -3 → -1) is valid and
			// gets allocated to pending backorders below.
			if (movement_type === 'out' && nextQty < 0) {
				throw new BadRequestException('Insufficient stock')
			}

			// Upsert store stock
			await tx.store_stock.upsert({
				where: { product_id },
				create: {
					seller_id: product.seller_id,
					product_id,
					quantity: nextQty,
					reserved_quantity: reserved,
					min_stock: current?.min_stock ?? 0,
					max_stock: current?.max_stock ?? 0,
				},
				update: { quantity: nextQty },
			})

			// Create movement record
			const movement = await tx.stock_movement.create({ data: data as any })

			// An incoming arrival covers part/all of the deficit — allocate it to the
			// product's pending backorders FIFO so the seller can finalize those orders.
			const fulfilled =
				movement_type === 'in'
					? await this.allocateBackorders(tx, product, currentQty, nextQty, reserved)
					: []

			return { movement: movement as unknown as StockMovement, fulfilled }
		})
	}

	// Distributes the units this arrival just covered across the product's pending
	// backorders, oldest first. The number now covered is the drop in the deficit
	// (owed = max(reserved - quantity, 0)); a row is marked `fulfilled` once its full
	// owed quantity is met. Returns the orders that became fully covered.
	private async allocateBackorders(
		tx: any,
		product: { id: number; name: string; seller_id: string },
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
