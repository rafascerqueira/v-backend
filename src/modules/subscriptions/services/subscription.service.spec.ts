/**
 * SubscriptionService unit tests
 * Covers: getAccountPlan, getActiveSubscription, getManageableSubscription,
 *         getCurrentUsage, refreshUsage, getSubscriptionInfo, updatePlan,
 *         syncStripeSubscription, hasBlockingSubscription, handleSubscriptionEnded
 * Verifies: default free plan fallback, usage record creation/retrieval
 */
import { Test } from '@nestjs/testing'
import { SettingsService } from '@/modules/admin/services/settings.service'
import {
	SUBSCRIPTION_REPOSITORY,
	type SubscriptionRepository,
} from '@/shared/repositories/subscription.repository'
import { PlanLimitsService } from './plan-limits.service'
import { SubscriptionService } from './subscription.service'

const repositoryMock: jest.Mocked<SubscriptionRepository> = {
	findAccountPlan: jest.fn(),
	updateAccountPlan: jest.fn(),
	findActiveSubscription: jest.fn(),
	findManageableSubscription: jest.fn(),
	findUsageRecord: jest.fn(),
	createUsageRecord: jest.fn(),
	upsertUsageRecord: jest.fn(),
	countResources: jest.fn(),
	findAccountEmailName: jest.fn(),
	updateSubscriptionsByProviderId: jest.fn(),
	upsertSubscriptionFromStripe: jest.fn(),
	findPaidAccountIds: jest.fn(),
	findStripeCustomerId: jest.fn(),
	setStripeCustomerIdIfMissing: jest.fn(),
	replaceStripeCustomerId: jest.fn(),
	findProviderCustomerIds: jest.fn(),
	findPayingProviderSubscriptionIds: jest.fn(),
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
				{
					provide: PlanLimitsService,
					useValue: { getEffectiveFeatures: jest.fn().mockResolvedValue({}) },
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

	describe('syncStripeSubscription', () => {
		it('upserts via the repository and never touches the account plan', async () => {
			repositoryMock.upsertSubscriptionFromStripe.mockResolvedValueOnce('created')
			const data = {
				account_id: 'acc-1',
				plan_type: 'pro',
				status: 'past_due',
				provider_subscription_id: 'sub_1',
				provider_customer_id: 'cus_1',
				current_period_start: null,
				current_period_end: null,
				cancel_at_period_end: false,
			}

			const op = await service.syncStripeSubscription(data)

			expect(op).toBe('created')
			expect(repositoryMock.upsertSubscriptionFromStripe).toHaveBeenCalledWith(data)
			expect(repositoryMock.updateAccountPlan).not.toHaveBeenCalled()
		})
	})

	describe('hasBlockingSubscription', () => {
		it.each([
			// [account plan, manageable sub status, blocks?]
			['pro', 'active', true],
			['pro', 'trialing', true],
			['pro', 'past_due', true], // paying customer in dunning → fix card in the portal
			['free', 'active', true],
			['free', 'past_due', false], // never-paid attempt (incomplete) → may retry checkout
			['free', null, false],
			['pro', null, false],
		])('plan=%s sub=%s → %s', async (plan, status, expected) => {
			repositoryMock.findAccountPlan.mockResolvedValueOnce(plan)
			repositoryMock.findManageableSubscription.mockResolvedValueOnce(
				status ? ({ id: 1, status, provider_customer_id: 'cus_1' } as any) : null,
			)

			await expect(service.hasBlockingSubscription('acc-1')).resolves.toBe(expected)
		})
	})

	describe('getPortalCustomerId', () => {
		// AUDIT-014: a legacy account may own several Customers; the portal must open the
		// one holding the live subscription, not merely the stored/newest one.
		it('prefers the Customer of the manageable (live) subscription', async () => {
			repositoryMock.findManageableSubscription.mockResolvedValueOnce({
				provider_customer_id: 'cus_live',
			} as any)

			await expect(service.getPortalCustomerId('acc-1')).resolves.toBe('cus_live')
			expect(repositoryMock.findStripeCustomerId).not.toHaveBeenCalled()
		})

		it("falls back to the account's own Customer (e.g. before any webhook landed)", async () => {
			repositoryMock.findManageableSubscription.mockResolvedValueOnce(null)
			repositoryMock.findStripeCustomerId.mockResolvedValueOnce('cus_account')

			await expect(service.getPortalCustomerId('acc-1')).resolves.toBe('cus_account')
		})

		it('returns null when the account has neither', async () => {
			repositoryMock.findManageableSubscription.mockResolvedValueOnce(null)
			repositoryMock.findStripeCustomerId.mockResolvedValueOnce(null)

			await expect(service.getPortalCustomerId('acc-1')).resolves.toBeNull()
		})
	})

	describe('getManageableSubscription', () => {
		it('should delegate to repository (keeps past_due so dunning sellers reach the portal)', async () => {
			repositoryMock.findManageableSubscription.mockResolvedValueOnce({
				id: 1,
				status: 'past_due',
				provider_customer_id: 'cus_1',
			} as any)

			const result = await service.getManageableSubscription('acc-1')

			expect(repositoryMock.findManageableSubscription).toHaveBeenCalledWith('acc-1')
			expect(result).toMatchObject({ status: 'past_due' })
		})
	})

	describe('getSubscriptionInfo', () => {
		it('returns a past_due subscription so the UI can show the dunning warning', async () => {
			const pastDue = {
				id: 9,
				status: 'past_due',
				plan_type: 'pro',
				provider_customer_id: 'cus_1',
				cancel_at_period_end: false,
			}
			repositoryMock.findAccountPlan.mockResolvedValueOnce('pro')
			repositoryMock.findManageableSubscription.mockResolvedValueOnce(pastDue as any)
			repositoryMock.findUsageRecord.mockResolvedValueOnce(mockUsageRecord as any)

			const info = await service.getSubscriptionInfo('acc-1')

			expect(repositoryMock.findManageableSubscription).toHaveBeenCalledWith('acc-1')
			expect(repositoryMock.findActiveSubscription).not.toHaveBeenCalled()
			expect(info.plan).toBe('pro')
			expect(info.subscription).toMatchObject({ status: 'past_due' })
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
