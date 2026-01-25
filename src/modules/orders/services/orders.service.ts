import { Injectable } from '@nestjs/common'
import { PrismaService } from '@/shared/prisma/prisma.service'
import { TenantContext } from '@/shared/tenant/tenant.context'
import type { CreateOrderDto, OrderItemInputDto } from '../dto/create-order.dto'

@Injectable()
export class OrdersService {
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

  async create(dto: CreateOrderDto) {
    const { items, ...rest } = dto

    const subtotal = items.reduce((acc, it) => acc + it.unit_price * it.quantity, 0)
    const discount = items.reduce((acc, it) => acc + it.discount, 0)
    const total = subtotal - discount

    return this.prisma.order.create({
      data: {
        seller_id: this.tenantContext.requireSellerId(),
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
    const order = await this.prisma.order.findUnique({ 
      where: { id }, 
      include: { Order_item: true, Billing: true, customer: true } 
    })
    if (!order) return null
    if (!this.tenantContext.isAdmin() && order.seller_id !== this.tenantContext.getSellerId()) {
      return null
    }
    return order
  }

  async findAll() {
    return this.prisma.order.findMany({
      where: this.getTenantFilter(),
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
    const order = await this.findById(id)
    if (!order) {
      throw new Error('Order not found or access denied')
    }
    return this.prisma.order.update({
      where: { id },
      data: { status: status as any },
    })
  }

  async delete(id: number) {
    const order = await this.findById(id)
    if (!order) {
      throw new Error('Order not found or access denied')
    }
    return this.prisma.order.delete({ where: { id } })
  }
}
