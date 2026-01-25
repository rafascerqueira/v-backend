import { Test } from '@nestjs/testing'
import { StoreStockService } from './store-stock.service'
import { PrismaService } from '@/shared/prisma/prisma.service'

const prismaMock = {
  store_stock: {
    findUnique: jest.fn(),
    upsert: jest.fn(),
  },
}

describe('StoreStockService', () => {
  let service: StoreStockService

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [StoreStockService, { provide: PrismaService, useValue: prismaMock }],
    }).compile()

    service = module.get(StoreStockService)
    jest.clearAllMocks()
  })

  it('getByProduct should call prisma.store_stock.findUnique', async () => {
    prismaMock.store_stock.findUnique.mockResolvedValueOnce({ product_id: 1, quantity: 5 })
    const res = await service.getByProduct(1)
    expect(prismaMock.store_stock.findUnique).toHaveBeenCalledWith({ where: { product_id: 1 } })
    expect(res).toEqual({ product_id: 1, quantity: 5 })
  })

  it('upsert should upsert store stock', async () => {
    prismaMock.store_stock.upsert.mockResolvedValueOnce({ product_id: 2, quantity: 10 })
    const res = await service.upsert(2, { quantity: 10 })
    expect(prismaMock.store_stock.upsert).toHaveBeenCalledWith({
      where: { product_id: 2 },
      create: expect.objectContaining({
        product_id: 2,
        quantity: 10,
        reserved_quantity: expect.any(Number),
        min_stock: expect.any(Number),
        max_stock: expect.any(Number),
      }),
      update: { quantity: 10 },
    })
    expect(res).toEqual({ product_id: 2, quantity: 10 })
  })
})
