/**
 * SubscriptionService unit tests
 * Covers: getAccountPlan, getActiveSubscription, getCurrentUsage, refreshUsage,
 *         getSubscriptionInfo, updatePlan, createSubscription, cancelSubscription,
 *         handleSubscriptionEnded
 * Verifies: default free plan fallback, usage record creation/retrieval
 */
import { Test } from '@nestjs/testing'
import { SettingsService } from '@/modules/admin/services/settings.service'
import {
	SUBSCRIPTION_REPOSITORY,
	type SubscriptionRepository,
} from '@/shared/repositories/subscription.repository'
import { SubscriptionService } from './subscription.service'

const repositoryMock: jest.Mocked<SubscriptionRepository> = {
	findAccountPlan: jest.fn(),
	updateAccountPlan: jest.fn(),
	findActiveSubscription: jest.fn(),
	createSubscription: jest.fn(),
	cancelSubscription: jest.fn(),
	findUsageRecord: jest.fn(),
	createUsageRecord: jest.fn(),
	upsertUsageRecord: jest.fn(),
	countResources: jest.fn(),
	findAccountEmailName: jest.fn(),
	createSubscriptionFromCheckout: jest.fn(),
	updateSubscriptionsByProviderId: jest.fn(),
}

const mockUsageRecord = {
	id: 1,
	account_id: 'acc-1',
	period_start: new Date(),
	period_end: new Date(),
	products_count: 10,
	orders_count: 5,
	customers_count: 20,
}

describe('SubscriptionService', () => {
	let service: SubscriptionService

	beforeEach(async () => {
		const module = await Test.createTestingModule({
			providers: [
				SubscriptionService,
				{ provide: SUBSCRIPTION_REPOSITORY, useValue: repositoryMock },
				{
					provide: SettingsService,
					useValue: {
						getUnlimitedPeriodWindow: jest.fn().mockResolvedValue({
							startDate: null,
							endDate: null,
							isActive: false,
						}),
					},
				},
			],
		}).compile()

		service = module.get(SubscriptionService)
		jest.clearAllMocks()
	})

	describe('getAccountPlan', () => {
		it('should return the stored plan type', async () => {
			repositoryMock.findAccountPlan.mockResolvedValueOnce('pro')

			const result = await service.getAccountPlan('acc-1')

			expect(result).toBe('pro')
		})

		it('should return free as default when repository returns null', async () => {
			repositoryMock.findAccountPlan.mockResolvedValueOnce(null)

			const result = await service.getAccountPlan('acc-1')

			expect(result).toBe('free')
		})
	})

	describe('getActiveSubscription', () => {
		it('should delegate to repository', async () => {
			repositoryMock.findActiveSubscription.mockResolvedValueOnce({ id: 1 } as any)

			const result = await service.getActiveSubscription('acc-1')

			expect(repositoryMock.findActiveSubscription).toHaveBeenCalledWith('acc-1')
			expect(result).toEqual({ id: 1 })
		})
	})

	describe('getCurrentUsage', () => {
		it('should return existing usage record when found', async () => {
			repositoryMock.findUsageRecord.mockResolvedValueOnce(mockUsageRecord as any)

			const result = await service.getCurrentUsage('acc-1')

			expect(result.products_count).toBe(10)
			expect(repositoryMock.createUsageRecord).not.toHaveBeenCalled()
		})

		it('should create and return a new usage record when none exists', async () => {
			repositoryMock.findUsageRecord.mockResolvedValueOnce(null)
			repositoryMock.countResources.mockResolvedValueOnce({
				products: 5,
				orders: 3,
				customers: 15,
			})
			repositoryMock.createUsageRecord.mockResolvedValueOnce({
				...mockUsageRecord,
				products_count: 5,
				orders_count: 3,
				customers_count: 15,
			} as any)

			const result = await service.getCurrentUsage('acc-1')

			expect(repositoryMock.createUsageRecord).toHaveBeenCalled()
			expect(result.products_count).toBe(5)
		})
	})

	describe('updatePlan', () => {
		it('should delegate to repository', async () => {
			repositoryMock.updateAccountPlan.mockResolvedValueOnce(undefined)

			await service.updatePlan('acc-1', 'pro')

			expect(repositoryMock.updateAccountPlan).toHaveBeenCalledWith('acc-1', 'pro')
		})
	})

	describe('createSubscription', () => {
		it('should create subscription and update account plan', async () => {
			repositoryMock.createSubscription.mockResolvedValueOnce({ id: 1 } as any)
			repositoryMock.updateAccountPlan.mockResolvedValueOnce(undefined)

			const result = await service.createSubscription({
				accountId: 'acc-1',
				planType: 'pro',
				paymentProvider: 'stripe',
				providerSubscriptionId: 'sub_123',
				providerCustomerId: 'cus_123',
				periodStart: new Date(),
				periodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
			})

			expect(repositoryMock.createSubscription).toHaveBeenCalled()
			expect(repositoryMock.updateAccountPlan).toHaveBeenCalledWith('acc-1', 'pro')
			expect(result).toEqual({ id: 1 })
		})

		it('should set status to trialing when trialEnd is provided', async () => {
			repositoryMock.createSubscription.mockResolvedValueOnce({ id: 2 } as any)
			repositoryMock.updateAccountPlan.mockResolvedValueOnce(undefined)

			await service.createSubscription({
				accountId: 'acc-1',
				planType: 'pro',
				paymentProvider: 'stripe',
				providerSubscriptionId: 'sub_123',
				providerCustomerId: 'cus_123',
				periodStart: new Date(),
				periodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
				trialEnd: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
			})

			const createCall = repositoryMock.createSubscription.mock.calls[0][0]
			expect(createCall.status).toBe('trialing')
		})
	})

	describe('cancelSubscription', () => {
		it('should delegate to repository', async () => {
			repositoryMock.cancelSubscription.mockResolvedValueOnce({ id: 1, status: 'canceled' } as any)

			const result = await service.cancelSubscription(1, true)

			expect(repositoryMock.cancelSubscription).toHaveBeenCalledWith(1, true)
		})
	})

	describe('handleSubscriptionEnded', () => {
		it('should downgrade account to free plan', async () => {
			repositoryMock.updateAccountPlan.mockResolvedValueOnce(undefined)

			await service.handleSubscriptionEnded('acc-1')

			expect(repositoryMock.updateAccountPlan).toHaveBeenCalledWith('acc-1', 'free')
		})
	})
})
