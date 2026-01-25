import { Test } from '@nestjs/testing'
import { StoreStockService } from './store-stock.service'
import { PrismaService } from '@/shared/prisma/prisma.service'
import { TenantContext } from '@/shared/tenant/tenant.context'

const prismaMock = {
  store_stock: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    upsert: jest.fn(),
  },
  product: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
  },
}

const tenantContextMock = {
  getSellerId: jest.fn().mockReturnValue('test-seller-id'),
  requireSellerId: jest.fn().mockReturnValue('test-seller-id'),
  isAdmin: jest.fn().mockReturnValue(false),
}

describe('StoreStockService', () => {
  let service: StoreStockService

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        StoreStockService, 
        { provide: PrismaService, useValue: prismaMock },
        { provide: TenantContext, useValue: tenantContextMock },
      ],
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
    prismaMock.product.findUnique.mockResolvedValueOnce({ id: 2, seller_id: 'test-seller-id' })
    prismaMock.store_stock.upsert.mockResolvedValueOnce({ product_id: 2, quantity: 10 })
    const res = await service.upsert(2, { quantity: 10 })
    expect(prismaMock.store_stock.upsert).toHaveBeenCalled()
    expect(res).toEqual({ product_id: 2, quantity: 10 })
  })
})
