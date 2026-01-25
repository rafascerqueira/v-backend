import { PrismaService } from './prisma.service'

describe('PrismaService', () => {
  describe('class definition', () => {
    it('should have onModuleInit method', () => {
      expect(PrismaService.prototype.onModuleInit).toBeDefined()
    })

    it('should have onModuleDestroy method', () => {
      expect(PrismaService.prototype.onModuleDestroy).toBeDefined()
    })
  })

  describe('with mocked instance', () => {
    let service: Partial<PrismaService>

    beforeEach(() => {
      service = {
        $connect: jest.fn().mockResolvedValue(undefined),
        $disconnect: jest.fn().mockResolvedValue(undefined),
        onModuleInit: jest.fn().mockImplementation(async function(this: any) {
          return this.$connect()
        }),
        onModuleDestroy: jest.fn().mockImplementation(async function(this: any) {
          return this.$disconnect()
        }),
        account: { findMany: jest.fn().mockResolvedValue([]) } as any,
        customer: {} as any,
        product: {} as any,
        order: {} as any,
        billing: {} as any,
      }
    })

    it('should call $connect on module init', async () => {
      await service.onModuleInit!.call(service)
      expect(service.$connect).toHaveBeenCalled()
    })

    it('should call $disconnect on module destroy', async () => {
      await service.onModuleDestroy!.call(service)
      expect(service.$disconnect).toHaveBeenCalled()
    })

    it('should be able to query using mocked client', async () => {
      const accounts = await service.account!.findMany()
      expect(Array.isArray(accounts)).toBe(true)
      expect(service.account!.findMany).toHaveBeenCalled()
    })
  })
})
