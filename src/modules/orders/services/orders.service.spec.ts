import { Test } from '@nestjs/testing'
import { OrdersService } from './orders.service'
import { PrismaService } from '@/shared/prisma/prisma.service'

const prismaMock = {
  order: { create: jest.fn(), findUnique: jest.fn() },
  order_item: { create: jest.fn() },
}

describe('OrdersService', () => {
  let service: OrdersService

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [OrdersService, { provide: PrismaService, useValue: prismaMock }],
    }).compile()

    service = module.get(OrdersService)
    jest.clearAllMocks()
  })

  it('create should compute totals and create order with items', async () => {
    const dto = {
      customer_id: 'cuid123',
      order_number: 'ORD-1',
      items: [
        { product_id: 1, quantity: 2, unit_price: 1000, discount: 0 },
        { product_id: 2, quantity: 1, unit_price: 500, discount: 100 },
      ],
    }
    prismaMock.order.create.mockResolvedValueOnce({ id: 1 })

    const res = await service.create(dto as any)

    expect(prismaMock.order.create).toHaveBeenCalled()
    const call = prismaMock.order.create.mock.calls[0][0]
    expect(call.data.subtotal).toBe(2500)
    expect(call.data.discount).toBe(100)
    expect(call.data.total).toBe(2400)
    expect(call.data.Order_item.create).toHaveLength(2)
    expect(res).toEqual({ id: 1 })
  })

  it('addItem should create order_item with computed total', async () => {
    prismaMock.order_item.create.mockResolvedValueOnce({ id: 10 })
    const res = await service.addItem(1, { product_id: 3, quantity: 2, unit_price: 300, discount: 50 } as any)
    expect(prismaMock.order_item.create).toHaveBeenCalledWith({
      data: { order_id: 1, product_id: 3, quantity: 2, unit_price: 300, discount: 50, total: 550 },
    })
    expect(res).toEqual({ id: 10 })
  })

  it('findById delegates to prisma', async () => {
    prismaMock.order.findUnique.mockResolvedValueOnce({ id: 1 })
    const res = await service.findById(1)
    expect(prismaMock.order.findUnique).toHaveBeenCalledWith({ where: { id: 1 }, include: { Order_item: true, Billing: true } })
    expect(res).toEqual({ id: 1 })
  })
})
