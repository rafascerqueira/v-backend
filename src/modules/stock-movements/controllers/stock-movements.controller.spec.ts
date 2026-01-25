import { Test } from '@nestjs/testing'
import { StockMovementsController } from './stock-movements.controller'
import { StockMovementsService } from '../services/stock-movements.service'

const serviceMock = {
  listByProduct: jest.fn(),
  create: jest.fn(),
}

describe('StockMovementsController', () => {
  let controller: StockMovementsController

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [StockMovementsController],
      providers: [{ provide: StockMovementsService, useValue: serviceMock }],
    }).compile()

    controller = module.get(StockMovementsController)
    jest.clearAllMocks()
  })

  it('list should call service.listByProduct with numeric id', async () => {
    serviceMock.listByProduct.mockResolvedValueOnce([{ id: 1 }])
    const res = await controller.list('42')
    expect(serviceMock.listByProduct).toHaveBeenCalledWith(42)
    expect(res).toEqual([{ id: 1 }])
  })

  it('create should call service.create and return movement', async () => {
    const dto = { movement_type: 'in', reference_type: 'purchase', reference_id: 1, product_id: 2, quantity: 5 } as any
    serviceMock.create.mockResolvedValueOnce({ id: 10, product_id: 2 })
    const res = await controller.create(dto)
    expect(serviceMock.create).toHaveBeenCalledWith(dto)
    expect(res).toEqual({ id: 10, product_id: 2 })
  })
})
