import { Injectable } from '@nestjs/common'
import { PrismaService } from '@/shared/prisma/prisma.service'
import type { CreateOrderDto, OrderItemInputDto } from '../dto/create-order.dto'

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateOrderDto) {
    const { items, ...rest } = dto

    const subtotal = items.reduce((acc, it) => acc + it.unit_price * it.quantity, 0)
    const discount = items.reduce((acc, it) => acc + it.discount, 0)
    const total = subtotal - discount

    return this.prisma.order.create({
      data: {
        seller_id: rest.seller_id,
        customer_id: rest.customer_id,
        order_number: rest.order_number,
        notes: rest.notes,
        subtotal,
        discount,
        total,
        Order_item: {
          create: items.map((it) => ({
            product_id: it.product_id,
            quantity: it.quantity,
            unit_price: it.unit_price,
            discount: it.discount,
            total: it.unit_price * it.quantity - it.discount,
          })),
        },
      },
      include: { Order_item: true },
    })
  }

  async addItem(orderId: number, item: OrderItemInputDto) {
    const total = item.unit_price * item.quantity - (item.discount ?? 0)
    return this.prisma.order_item.create({
      data: { order_id: orderId, product_id: item.product_id, quantity: item.quantity, unit_price: item.unit_price, discount: item.discount ?? 0, total },
    })
  }

  async findById(id: number) {
    return this.prisma.order.findUnique({ where: { id }, include: { Order_item: true, Billing: true, customer: true } })
  }

  async findAll() {
    return this.prisma.order.findMany({
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
    })
  }

  async updateStatus(id: number, status: string) {
    return this.prisma.order.update({
      where: { id },
      data: { status: status as any },
    })
  }

  async delete(id: number) {
    return this.prisma.order.delete({ where: { id } })
  }
}
