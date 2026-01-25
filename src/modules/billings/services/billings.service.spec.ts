import { Test } from '@nestjs/testing'
import { BillingsService } from './billings.service'
import { PrismaService } from '@/shared/prisma/prisma.service'

const prismaMock = {
  billing: {
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
}

describe('BillingsService', () => {
  let service: BillingsService

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [BillingsService, { provide: PrismaService, useValue: prismaMock }],
    }).compile()

    service = module.get(BillingsService)
    jest.clearAllMocks()
  })

  it('listByOrder should call prisma.findMany', async () => {
    prismaMock.billing.findMany.mockResolvedValueOnce([])
    const res = await service.listByOrder(1)
    expect(prismaMock.billing.findMany).toHaveBeenCalledWith({ where: { order_id: 1 } })
    expect(res).toEqual([])
  })

  it('create should map dates and set order_id', async () => {
    prismaMock.billing.create.mockResolvedValueOnce({ id: 1 })
    const res = await service.create(2, { billing_number: 'B-1', total_amount: 1000, due_date: '2025-01-01T00:00:00.000Z' } as any)
    expect(prismaMock.billing.create).toHaveBeenCalled()
    const call = prismaMock.billing.create.mock.calls[0][0]
    expect(call.data.order_id).toBe(2)
    expect(call.data.due_date instanceof Date).toBe(true)
    expect(res).toEqual({ id: 1 })
  })

  it('update should map nullable dates', async () => {
    prismaMock.billing.update.mockResolvedValueOnce({ id: 3 })
    const res = await service.update(3, { payment_date: undefined, notes: 'ok' } as any)
    expect(prismaMock.billing.update).toHaveBeenCalledWith({
      where: { id: 3 },
      data: expect.objectContaining({ notes: 'ok', payment_date: undefined }),
    })
    expect(res).toEqual({ id: 3 })
  })
})
