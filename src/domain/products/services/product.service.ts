import { Injectable } from '@nestjs/common'
import { PrismaService } from 'src/infrastructure/prisma/prisma.service'

type CreateProductData = {
  name: string
  description: string
  sku: string
  category: string
  brand: string
  unit?: string
  specifications: object
  images: string[]
  active?: boolean
}

@Injectable()
export class ProductService {
  constructor(private prisma: PrismaService) {}

  async create(data: CreateProductData) {
    await this.prisma.product.create({
      data,
    })
  }

  async findAll() {
    return this.prisma.product.findMany()
  }

  async findById(id: string) {
    return this.prisma.product.findUnique({
      where: {
        id: parseInt(id),
      },
    })
  }

  async update(id: string, data: CreateProductData) {
    return this.prisma.product.update({
      where: {
        id: parseInt(id),
      },
      data,
    })
  }

  async delete(id: string) {
    return this.prisma.product.delete({
      where: {
        id: parseInt(id),
      },
    })
  }

  async findByName(name: string) {
    return this.prisma.product.findFirst({
      where: {
        name: {
          contains: name,
          mode: 'insensitive',
        },
      },
    })
  }
}
