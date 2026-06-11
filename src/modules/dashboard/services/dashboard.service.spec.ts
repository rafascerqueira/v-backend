/**
 * DashboardService unit tests
 * Covers: getStats (regular seller, admin bypass)
 * Verifies: tenant filter application, product name mapping, order mapping
 */
import { Test } from '@nestjs/testing'
import { RedisService } from '@/shared/redis/redis.service'
import {
	DASHBOARD_REPOSITORY,
	type DashboardRepository,
} from '@/shared/repositories/dashboard.repository'
import { TenantContext } from '@/shared/tenant/tenant.context'
import { DashboardService } from './dashboard.service'

const repositoryMock: jest.Mocked<DashboardRepository> = {
	getStats: jest.fn(),
}

const tenantContextMock = {
	isAdmin: jest.fn().mockReturnValue(false),
	requireSellerId: jest.fn().mockReturnValue('seller-1'),
	getSellerId: jest.fn().mockReturnValue('seller-1'),
}

const redisMock = {
	get: jest.fn().mockResolvedValue(null),
	setWithExpiry: jest.fn().mockResolvedValue(undefined),
}

const mockStats = {
	totalProducts: 10,
	totalCustomers: 20,
	totalOrders: 30,
	pendingOrders: 5,
	totalRevenue: 50000,
	recentOrders: [
		{
			id: 1,
			order_number: 'ORD-1',
			customer: { name: 'Alice' },
			total: 1000,
			status: 'pending',
			createdAt: new Date(),
		},
	],
	topProducts: [{ product_id: 1, _sum: { quantity: 10 } }],
	productNames: new Map([[1, 'Product Alpha']]),
}

describe('DashboardService', () => {
	let service: DashboardService

	beforeEach(async () => {
		const module = await Test.createTestingModule({
			providers: [
				DashboardService,
				{ provide: DASHBOARD_REPOSITORY, useValue: repositoryMock },
				{ provide: TenantContext, useValue: tenantContextMock },
				{ provide: RedisService, useValue: redisMock },
			],
		}).compile()

		service = module.get(DashboardService)
		jest.clearAllMocks()
	})

	describe('getStats', () => {
		it('should pass seller_id filter for non-admin tenants', async () => {
			tenantContextMock.isAdmin.mockReturnValueOnce(false)
			repositoryMock.getStats.mockResolvedValueOnce(mockStats as any)

			await service.getStats('seller-1')

			expect(repositoryMock.getStats).toHaveBeenCalledWith({ seller_id: 'seller-1' })
		})

		it('should pass empty filter for admin tenants', async () => {
			tenantContextMock.isAdmin.mockReturnValueOnce(true)
			repositoryMock.getStats.mockResolvedValueOnce(mockStats as any)

			await service.getStats('seller-1')

			expect(repositoryMock.getStats).toHaveBeenCalledWith({})
		})

		it('should map top products with their names', async () => {
			tenantContextMock.isAdmin.mockReturnValueOnce(false)
			repositoryMock.getStats.mockResolvedValueOnce(mockStats as any)

			const result = await service.getStats('seller-1')

			expect(result.topProducts[0].name).toBe('Product Alpha')
			expect(result.topProducts[0].sales).toBe(10)
		})

		it('should use fallback name when product has been removed', async () => {
			tenantContextMock.isAdmin.mockReturnValueOnce(false)
			const statsWithMissingProduct = {
				...mockStats,
				topProducts: [{ product_id: 999, _sum: { quantity: 5 } }],
				productNames: new Map(),
			}
			repositoryMock.getStats.mockResolvedValueOnce(statsWithMissingProduct as any)

			const result = await service.getStats('seller-1')

			expect(result.topProducts[0].name).toBe('Produto removido')
		})

		it('should map recent orders with customer name fallback', async () => {
			tenantContextMock.isAdmin.mockReturnValueOnce(false)
			const statsWithNullCustomer = {
				...mockStats,
				recentOrders: [
					{
						id: 2,
						order_number: 'ORD-2',
						customer: null,
						total: 500,
						status: 'confirmed',
						createdAt: new Date(),
					},
				],
			}
			repositoryMock.getStats.mockResolvedValueOnce(statsWithNullCustomer as any)

			const result = await service.getStats('seller-1')

			expect(result.recentOrders[0].customer).toBe('Cliente removido')
		})

		it('should return integer revenue', async () => {
			tenantContextMock.isAdmin.mockReturnValueOnce(false)
			repositoryMock.getStats.mockResolvedValueOnce(mockStats as any)

			const result = await service.getStats('seller-1')

			expect(Number.isInteger(result.totalRevenue)).toBe(true)
		})
	})
})
