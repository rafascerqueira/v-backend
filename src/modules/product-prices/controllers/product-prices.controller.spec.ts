import { Test } from '@nestjs/testing'
import { ProductPricesController } from './product-prices.controller'
import { ProductPricesService } from '../services/product-prices.service'
import { ZodValidationPipe } from '../../../shared/pipes/zod-validation.pipe'

const serviceMock = {
  listByProduct: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  deactivate: jest.fn(),
}

describe('ProductPricesController', () => {
  let controller: ProductPricesController

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [ProductPricesController],
      providers: [{ provide: ProductPricesService, useValue: serviceMock }],
    }).compile()

    controller = module.get(ProductPricesController)
    jest.clearAllMocks()
  })

  it('list should call service.listByProduct with number param', async () => {
    serviceMock.listByProduct.mockResolvedValueOnce([])
    const res = await controller.list('5')
    expect(serviceMock.listByProduct).toHaveBeenCalledWith(5)
    expect(res).toEqual([])
  })

  it('create should validate body and call service.create', async () => {
    serviceMock.create.mockResolvedValueOnce({ id: 1, product_id: 7, price: 1000 })
    const body = {
      price: 1000,
      price_type: 'sale',
      valid_from: '2025-01-01T00:00:00.000Z',
      active: true,
    }

    // Simulate Nest parameter pipe by instantiating the Zod pipe
    const pipe = new ZodValidationPipe((await import('../dto/create-product-price.dto')).createProductPriceSchema)
    const parsed = pipe.transform(body)

    const res = await controller.create('7', parsed as any)

    expect(serviceMock.create).toHaveBeenCalledWith(7, expect.objectContaining({ price: 1000 }))
    expect(res).toMatchObject({ id: 1 })
  })

  it('update should validate body and call service.update', async () => {
    serviceMock.update.mockResolvedValueOnce({ id: 2, price: 1500 })
    const body = { price: 1500, valid_to: null }

    const pipe = new ZodValidationPipe((await import('../dto/update-product-price.dto')).updateProductPriceSchema)
    const parsed = pipe.transform(body)

    const res = await controller.update('2', parsed as any)

    expect(serviceMock.update).toHaveBeenCalledWith(2, expect.objectContaining({ price: 1500 }))
    expect(res).toMatchObject({ id: 2 })
  })

  it('deactivate should call service.deactivate', async () => {
    serviceMock.deactivate.mockResolvedValueOnce({ id: 3, active: false })
    const res = await controller.deactivate('3')
    expect(serviceMock.deactivate).toHaveBeenCalledWith(3)
    expect(res).toMatchObject({ active: false })
  })
})
