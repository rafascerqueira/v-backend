import { BadRequestException, Injectable } from '@nestjs/common'
import { PrismaService } from '@/shared/prisma/prisma.service'
import type {
	CreateStockMovementData,
	StockMovement,
	StockMovementRepository,
} from '@/shared/repositories/stock-movement.repository'

@Injectable()
export class PrismaStockMovementRepository implements StockMovementRepository {
	constructor(private readonly prisma: PrismaService) {}

	async findByProduct(productId: number): Promise<StockMovement[]> {
		return this.prisma.stock_movement.findMany({
			where: { product_id: productId },
			orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
		}) as unknown as StockMovement[]
	}

	async create(data: CreateStockMovementData): Promise<StockMovement> {
		const { movement_type, product_id, quantity } = data

		return this.prisma.$transaction(async (tx) => {
			// Ensure product exists
			const product = await tx.product.findUnique({
				where: { id: product_id },
			})
			if (!product) throw new BadRequestException('Product not found')

			// Current stock
			const current = await tx.store_stock.findUnique({
				where: { product_id },
			})
			const currentQty = current?.quantity ?? 0

			const delta = movement_type === 'in' ? quantity : -quantity
			const nextQty = currentQty + delta
			if (nextQty < 0) {
				throw new BadRequestException('Insufficient stock')
			}

			// Upsert store stock
			await tx.store_stock.upsert({
				where: { product_id },
				create: {
					seller_id: product.seller_id,
					product_id,
					quantity: nextQty,
					reserved_quantity: current?.reserved_quantity ?? 0,
					min_stock: current?.min_stock ?? 0,
					max_stock: current?.max_stock ?? 0,
				},
				update: { quantity: nextQty },
			})

			// Create movement record
			const movement = await tx.stock_movement.create({ data: data as any })
			return movement as unknown as StockMovement
		})
	}
}
