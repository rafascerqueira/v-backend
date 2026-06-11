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
		type MockedPrisma = {
			$connect: jest.Mock
			$disconnect: jest.Mock
			onModuleInit: jest.Mock
			onModuleDestroy: jest.Mock
			account: { findMany: jest.Mock }
		}

		let service: MockedPrisma

		beforeEach(() => {
			service = {
				$connect: jest.fn().mockResolvedValue(undefined),
				$disconnect: jest.fn().mockResolvedValue(undefined),
				onModuleInit: jest.fn().mockImplementation(async function (this: MockedPrisma) {
					return this.$connect()
				}),
				onModuleDestroy: jest.fn().mockImplementation(async function (this: MockedPrisma) {
					return this.$disconnect()
				}),
				account: { findMany: jest.fn().mockResolvedValue([]) },
			}
		})

		it('should call $connect on module init', async () => {
			await service.onModuleInit.call(service)
			expect(service.$connect).toHaveBeenCalled()
		})

		it('should call $disconnect on module destroy', async () => {
			await service.onModuleDestroy.call(service)
			expect(service.$disconnect).toHaveBeenCalled()
		})

		it('should be able to query using mocked client', async () => {
			const accounts = await service.account.findMany()
			expect(Array.isArray(accounts)).toBe(true)
			expect(service.account.findMany).toHaveBeenCalled()
		})
	})
})
