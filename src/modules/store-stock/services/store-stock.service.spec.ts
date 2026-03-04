import { Test } from '@nestjs/testing'
import { StoreStockService } from './store-stock.service'
import { STORE_STOCK_REPOSITORY } from '@/shared/repositories/store-stock.repository'

const repositoryMock = {
  findAll: jest.fn(),
  findByProduct: jest.fn(),
  upsert: jest.fn(),
}

describe('StoreStockService', () => {
  let service: StoreStockService

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        StoreStockService,
        { provide: STORE_STOCK_REPOSITORY, useValue: repositoryMock },
      ],
    }).compile()

    service = module.get(StoreStockService)
    jest.clearAllMocks()
  })

  it('getByProduct should delegate to repository', async () => {
    repositoryMock.findByProduct.mockResolvedValueOnce({ product_id: 1, quantity: 5 })
    const res = await service.getByProduct(1)
    expect(repositoryMock.findByProduct).toHaveBeenCalledWith(1)
    expect(res).toEqual({ product_id: 1, quantity: 5 })
  })

  it('upsert should delegate to repository', async () => {
    repositoryMock.upsert.mockResolvedValueOnce({ product_id: 2, quantity: 10 })
    const res = await service.upsert(2, { quantity: 10 })
    expect(repositoryMock.upsert).toHaveBeenCalledWith(2, { quantity: 10 })
    expect(res).toEqual({ product_id: 2, quantity: 10 })
  })

  it('findAll should delegate to repository', async () => {
    repositoryMock.findAll.mockResolvedValueOnce([])
    const res = await service.findAll()
    expect(repositoryMock.findAll).toHaveBeenCalledWith({})
    expect(res).toEqual([])
  })
})
