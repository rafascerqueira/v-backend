import { Test } from '@nestjs/testing'
import { ProductPricesService } from './product-prices.service'
import { PRODUCT_PRICE_REPOSITORY } from '@/shared/repositories/product-price.repository'

const repositoryMock = {
  findByProduct: jest.fn(),
  findById: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  deactivate: jest.fn(),
}

describe('ProductPricesService', () => {
  let service: ProductPricesService

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        ProductPricesService,
        { provide: PRODUCT_PRICE_REPOSITORY, useValue: repositoryMock },
      ],
    }).compile()

    service = module.get(ProductPricesService)
    jest.clearAllMocks()
  })

  it('listByProduct should delegate to repository', async () => {
    repositoryMock.findByProduct.mockResolvedValueOnce([])

    const result = await service.listByProduct(10)

    expect(repositoryMock.findByProduct).toHaveBeenCalledWith(10)
    expect(result).toEqual([])
  })

  it('create should map dates and delegate to repository', async () => {
    const dto = {
      price: 1000,
      price_type: 'sale' as const,
      valid_from: '2025-01-01T00:00:00.000Z',
      valid_to: undefined,
      active: true,
    }
    const expected = { id: 1, product_id: 20, price: 1000 }
    repositoryMock.create.mockResolvedValueOnce(expected)

    const res = await service.create(20, dto)

    expect(repositoryMock.create).toHaveBeenCalled()
    const call = repositoryMock.create.mock.calls[0][0]
    expect(call.product_id).toBe(20)
    expect(call.price).toBe(1000)
    expect(call.valid_from instanceof Date).toBe(true)
    expect(call.valid_to).toBeUndefined()
    expect(res).toBe(expected)
  })

  it('update should map dates and delegate to repository', async () => {
    const dto = { price: 1500, valid_from: '2025-02-01T00:00:00.000Z', valid_to: null }
    const expected = { id: 2, price: 1500 }
    repositoryMock.update.mockResolvedValueOnce(expected)

    const res = await service.update(2, dto as any)

    expect(repositoryMock.update).toHaveBeenCalledWith(
      2,
      expect.objectContaining({ price: 1500, valid_from: expect.any(Date), valid_to: undefined }),
    )
    expect(res).toBe(expected)
  })

  it('deactivate should delegate to repository', async () => {
    const expected = { id: 3, active: false }
    repositoryMock.deactivate.mockResolvedValueOnce(expected)

    const res = await service.deactivate(3)

    expect(repositoryMock.deactivate).toHaveBeenCalledWith(3)
    expect(res).toBe(expected)
  })

  it('hasProductPrice should delegate to repository findById', async () => {
    repositoryMock.findById.mockResolvedValueOnce({ id: 5 })
    const res = await service.hasProductPrice(5)
    expect(repositoryMock.findById).toHaveBeenCalledWith(5)
    expect(res).toEqual({ id: 5 })
  })
})
