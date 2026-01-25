import { Injectable } from '@nestjs/common'
import { PrismaService } from '@/shared/prisma/prisma.service'
import type { CreateProductPriceDto } from '../dto/create-product-price.dto'
import type { UpdateProductPriceDto } from '../dto/update-product-price.dto'

@Injectable()
export class ProductPricesService {
  constructor(private readonly prisma: PrismaService) {}

  async listByProduct(productId: number) {
    return this.prisma.product_price.findMany({
      where: { product_id: productId },
      orderBy: [{ valid_from: 'desc' }, { createdAt: 'desc' }],
    })
  }

  async create(productId: number, dto: CreateProductPriceDto) {
    const { valid_from, valid_to, ...rest } = dto

    // TODO: add business validation for overlapping periods if needed

    return this.prisma.product_price.create({
      data: {
        product_id: productId,
        ...rest,
        valid_from: valid_from ? new Date(valid_from) : undefined,
        valid_to: valid_to ? new Date(valid_to) : undefined,
      },
    })
  }

  async update(id: number, dto: UpdateProductPriceDto) {
    const { valid_from, valid_to, ...rest } = dto
    return this.prisma.product_price.update({
      where: { id },
      data: {
        ...rest,
        valid_from: valid_from ? new Date(valid_from) : undefined,
        valid_to: valid_to ? new Date(valid_to) : undefined,
      },
    })
  }

  async deactivate(id: number) {
    return this.prisma.product_price.update({
      where: { id },
      data: { active: false },
    })
  }

  async hasProductPrice(id: number) {
    return this.prisma.product_price.findUnique({ where: { id } })
  }
}
