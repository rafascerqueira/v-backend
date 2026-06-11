/**
 * DashboardController unit tests
 * Covers: GET /dashboard/stats — returns statistics for the current user
 * Guards mocked: JwtAuthGuard
 */

import { Test } from '@nestjs/testing'
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard'
import { DashboardService } from '../services/dashboard.service'
import { DashboardController } from './dashboard.controller'

const serviceMock = {
	getStats: jest.fn(),
}

const mockUser = {
	sub: 'user-uuid-1',
	email: 'test@example.com',
	role: 'seller' as const,
	plan_type: 'free' as const,
}

describe('DashboardController', () => {
	let controller: DashboardController

	beforeEach(async () => {
		const module = await Test.createTestingModule({
			controllers: [DashboardController],
			providers: [{ provide: DashboardService, useValue: serviceMock }],
		})
			.overrideGuard(JwtAuthGuard)
			.useValue({ canActivate: () => true })
			.compile()

		controller = module.get(DashboardController)
		jest.clearAllMocks()
	})

	describe('getStats', () => {
		it('should return dashboard statistics for the current user', async () => {
			const stats = {
				totalOrders: 42,
				totalRevenue: 150000,
				totalCustomers: 15,
				totalProducts: 30,
			}
			serviceMock.getStats.mockResolvedValueOnce(stats)

			const result = await controller.getStats(mockUser)

			expect(serviceMock.getStats).toHaveBeenCalledWith('user-uuid-1')
			expect(result).toEqual(stats)
		})

		it('should propagate service errors', async () => {
			serviceMock.getStats.mockRejectedValueOnce(new Error('Stats unavailable'))

			await expect(controller.getStats(mockUser)).rejects.toThrow('Stats unavailable')
		})
	})
})
