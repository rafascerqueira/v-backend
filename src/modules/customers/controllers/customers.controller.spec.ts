import { Test } from '@nestjs/testing'
import { CustomersController } from './customers.controller'
import { CustomersService } from '../services/customers.service'
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard'

const serviceMock = {
  create: jest.fn(),
  findAll: jest.fn(),
  findAllPaginated: jest.fn(),
  findOne: jest.fn(),
  update: jest.fn(),
  remove: jest.fn(),
}

const mockRequest = {
  user: { sub: 'test-seller-id', role: 'seller' },
}

describe('CustomersController', () => {
  let controller: CustomersController

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [CustomersController],
      providers: [{ provide: CustomersService, useValue: serviceMock }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile()

    controller = module.get(CustomersController)
    jest.clearAllMocks()
  })

  it('create should call service.create and return customer', async () => {
    const dto: any = { name: 'John', email: 'john@ex.com', phone: '999', address: 'Addr' }
    serviceMock.create.mockResolvedValueOnce({ id: 'c1', ...dto })
    const res = await controller.create(dto, mockRequest)
    expect(serviceMock.create).toHaveBeenCalledWith({ ...dto, seller_id: 'test-seller-id' })
    expect(res.id).toBe('c1')
  })

  it('findAll should return paginated data', async () => {
    const paginatedResult = { data: [{ id: 'c1' }], total: 1, page: 1, limit: 10 }
    serviceMock.findAllPaginated.mockResolvedValueOnce(paginatedResult)
    const res = await controller.findAll({ page: '1', limit: '10' })
    expect(res).toEqual(paginatedResult)
  })

  it('findOne should call service with id', async () => {
    serviceMock.findOne.mockResolvedValueOnce({ id: 'c2' })
    const res = await controller.findOne('c2')
    expect(serviceMock.findOne).toHaveBeenCalledWith('c2')
    expect(res).toEqual({ id: 'c2' })
  })

  it('update should call service.update', async () => {
    const partial: any = { name: 'Jane' }
    serviceMock.update.mockResolvedValueOnce({ id: 'c3', name: 'Jane' })
    const res = await controller.update('c3', partial)
    expect(serviceMock.update).toHaveBeenCalledWith('c3', partial)
    expect(res).toEqual({ id: 'c3', name: 'Jane' })
  })

  it('remove should call service.remove', async () => {
    serviceMock.remove.mockResolvedValueOnce({ id: 'c4' })
    const res = await controller.remove('c4')
    expect(serviceMock.remove).toHaveBeenCalledWith('c4')
    expect(res).toEqual({ id: 'c4' })
  })
})
