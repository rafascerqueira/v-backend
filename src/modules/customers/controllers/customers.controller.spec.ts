import { Test } from '@nestjs/testing'
import { CustomersController } from './customers.controller'
import { CustomersService } from '../services/customers.service'

const serviceMock = {
  create: jest.fn(),
  findAll: jest.fn(),
  findOne: jest.fn(),
  update: jest.fn(),
  remove: jest.fn(),
}

describe('CustomersController', () => {
  let controller: CustomersController

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [CustomersController],
      providers: [{ provide: CustomersService, useValue: serviceMock }],
    }).compile()

    controller = module.get(CustomersController)
    jest.clearAllMocks()
  })

  it('create should call service.create and return customer', async () => {
    const dto: any = { name: 'John', email: 'john@ex.com', phone: '999', address: 'Addr' }
    serviceMock.create.mockResolvedValueOnce({ id: 'c1', ...dto })
    const res = await controller.create(dto)
    expect(serviceMock.create).toHaveBeenCalledWith(dto)
    expect(res.id).toBe('c1')
  })

  it('findAll should return array', async () => {
    serviceMock.findAll.mockResolvedValueOnce([{ id: 'c1' }])
    const res = await controller.findAll()
    expect(res).toEqual([{ id: 'c1' }])
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
