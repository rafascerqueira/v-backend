import { BadRequestException, Injectable } from '@nestjs/common'
import { PrismaService } from '@/shared/prisma/prisma.service'
import type { CreateStockMovementDto } from '../dto/create-stock-movement.dto'

@Injectable()
export class StockMovementsService {
  constructor(private readonly prisma: PrismaService) {}

  async listByProduct(productId: number) {
    return this.prisma.stock_movement.findMany({
      where: { product_id: productId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    })
  }

  async create(dto: CreateStockMovementDto) {
    const { movement_type, product_id, quantity } = dto

    return this.prisma.$transaction(async (tx) => {
      // Ensure product exists (FK will also enforce)
      const product = await tx.product.findUnique({ where: { id: product_id } })
      if (!product) throw new BadRequestException('Product not found')

      // Current stock
      const current = await tx.store_stock.findUnique({ where: { product_id } })
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
      const movement = await tx.stock_movement.create({ data: dto })
      return movement
    })
  }
}
