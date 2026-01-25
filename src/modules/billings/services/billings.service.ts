import { Injectable } from '@nestjs/common'
import { PrismaService } from '@/shared/prisma/prisma.service'
import type { CreateBillingDto } from '../dto/create-billing.dto'
import type { UpdateBillingDto } from '../dto/update-billing.dto'

@Injectable()
export class BillingsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    return this.prisma.billing.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        order: {
          select: {
            id: true,
            order_number: true,
            customer: {
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

  async listByOrder(orderId: number) {
    return this.prisma.billing.findMany({ where: { order_id: orderId } })
  }

  async create(orderId: number, dto: CreateBillingDto) {
    const { due_date, payment_date, ...rest } = dto
    return this.prisma.billing.create({
      data: {
        order_id: orderId,
        ...rest,
        due_date: due_date ? new Date(due_date) : undefined,
        payment_date: payment_date ? new Date(payment_date) : undefined,
      },
    })
  }

  async update(id: number, dto: UpdateBillingDto) {
    const { due_date, payment_date, ...rest } = dto
    return this.prisma.billing.update({
      where: { id },
      data: {
        ...rest,
        due_date: due_date ? new Date(due_date) : undefined,
        payment_date: payment_date ? new Date(payment_date) : undefined,
      },
    })
  }
}
