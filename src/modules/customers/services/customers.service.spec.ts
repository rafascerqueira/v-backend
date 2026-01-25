import { ConflictException, NotFoundException } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { CustomersService } from './customers.service'
import { CUSTOMER_REPOSITORY } from '@/shared/repositories/customer.repository'
import { Prisma } from '@/generated/prisma/client'

function makeP2002(target: string[]): Prisma.PrismaClientKnownRequestError {
  const err = new Error('Unique constraint') as unknown as Prisma.PrismaClientKnownRequestError & { code?: string; meta?: any }
  ;(err as any).code = 'P2002'
  ;(err as any).meta = { target }
  Object.setPrototypeOf(err, Prisma.PrismaClientKnownRequestError.prototype)
  return err as unknown as Prisma.PrismaClientKnownRequestError
}

describe('CustomersService', () => {
  let service: CustomersService
  const customerRepository = {
    create: jest.fn(),
    findAll: jest.fn(),
    findById: jest.fn(),
    findByEmail: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  }

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        CustomersService,
        { provide: CUSTOMER_REPOSITORY, useValue: customerRepository },
      ],
    }).compile()

    service = module.get(CustomersService)
    jest.clearAllMocks()
  })

  it('create should return created customer', async () => {
    customerRepository.create.mockResolvedValueOnce({ id: 'c1' })
    const res = await service.create({ name: 'John', email: 'john@ex.com', phone: '9', address: {} } as any)
    expect(customerRepository.create).toHaveBeenCalled()
    expect(res).toEqual({ id: 'c1' })
  })

  it('create should throw ConflictException for email unique violation', async () => {
    customerRepository.create.mockRejectedValueOnce(makeP2002(['email']))
    await expect(service.create({} as any)).rejects.toBeInstanceOf(ConflictException)
  })

  it('create should throw ConflictException for phone unique violation', async () => {
    customerRepository.create.mockRejectedValueOnce(makeP2002(['phone']))
    await expect(service.create({} as any)).rejects.toBeInstanceOf(ConflictException)
  })

  it('findOne should throw NotFoundException when missing', async () => {
    customerRepository.findById.mockResolvedValueOnce(null)
    await expect(service.findOne('id-x')).rejects.toBeInstanceOf(NotFoundException)
  })

  it('update should pass through to repository', async () => {
    customerRepository.update.mockResolvedValueOnce({ id: 'c2' })
    const res = await service.update('c2', { name: 'Jane' })
    expect(customerRepository.update).toHaveBeenCalledWith('c2', { name: 'Jane' })
    expect(res).toEqual({ id: 'c2' })
  })

  it('remove should call repository.delete', async () => {
    customerRepository.delete.mockResolvedValueOnce({ id: 'c3' })
    const res = await service.remove('c3')
    expect(customerRepository.delete).toHaveBeenCalledWith('c3')
    expect(res).toEqual({ id: 'c3' })
  })
})
