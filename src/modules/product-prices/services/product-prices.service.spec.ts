import { Test } from '@nestjs/testing'
import { ProductPricesService } from './product-prices.service'
import { PrismaService } from '@/shared/prisma/prisma.service'

const prismaMock = {
  product_price: {
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
}

describe('ProductPricesService', () => {
  let service: ProductPricesService

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [ProductPricesService, { provide: PrismaService, useValue: prismaMock }],
    }).compile()

    service = module.get(ProductPricesService)
    jest.clearAllMocks()
  })

  it('listByProduct should call prisma with correct where/orderBy', async () => {
    prismaMock.product_price.findMany.mockResolvedValueOnce([])
    const productId = 10

    const result = await service.listByProduct(productId)

    expect(prismaMock.product_price.findMany).toHaveBeenCalledWith({
      where: { product_id: productId },
      orderBy: [{ valid_from: 'desc' }, { createdAt: 'desc' }],
    })
    expect(result).toEqual([])
  })

  it('create should map dates and call prisma.create with product_id', async () => {
    const dto = {
      price: 1000,
      price_type: 'sale' as const,
      valid_from: '2025-01-01T00:00:00.000Z',
      valid_to: undefined,
      active: true,
    }
    const expected = { id: 1, product_id: 20, price: 1000 }
    prismaMock.product_price.create.mockResolvedValueOnce(expected)

    const res = await service.create(20, dto)

    expect(prismaMock.product_price.create).toHaveBeenCalled()
    const call = prismaMock.product_price.create.mock.calls[0][0]
    expect(call.data.product_id).toBe(20)
    expect(call.data.price).toBe(1000)
    expect(call.data.valid_from instanceof Date).toBe(true)
    expect(call.data.valid_to).toBeUndefined()
    expect(res).toBe(expected)
  })

  it('update should map dates and call prisma.update', async () => {
    const dto = { price: 1500, valid_from: '2025-02-01T00:00:00.000Z', valid_to: null }
    const expected = { id: 2, price: 1500 }
    prismaMock.product_price.update.mockResolvedValueOnce(expected)

    const res = await service.update(2, dto as any)

    expect(prismaMock.product_price.update).toHaveBeenCalledWith({
      where: { id: 2 },
      data: expect.objectContaining({ price: 1500, valid_from: expect.any(Date), valid_to: undefined }),
    })
    expect(res).toBe(expected)
  })

  it('deactivate should set active=false', async () => {
    const expected = { id: 3, active: false }
    prismaMock.product_price.update.mockResolvedValueOnce(expected)

    const res = await service.deactivate(3)

    expect(prismaMock.product_price.update).toHaveBeenCalledWith({
      where: { id: 3 },
      data: { active: false },
    })
    expect(res).toBe(expected)
  })
})
