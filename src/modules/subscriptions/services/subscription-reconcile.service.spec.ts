/**
 * SubscriptionReconcileService unit tests
 * Verifies: skip when Stripe unconfigured; upsert + plan activation for active/trialing;
 *           past_due keeps access (no plan change, no downgrade); bidirectional downgrade
 *           of locally-paid accounts that Stripe no longer reports as paid.
 */
import { Test } from '@nestjs/testing'
import { SUBSCRIPTION_REPOSITORY } from '@/shared/repositories/subscription.repository'
import type { ManagedStripeSubscription } from './stripe.service'
import { StripeService } from './stripe.service'
import { SubscriptionReconcileService } from './subscription-reconcile.service'

const stripeServiceMock = {
	isConfigured: jest.fn(),
	listManagedSubscriptions: jest.fn(),
}

const repoMock: Record<string, jest.Mock> = {
	upsertSubscriptionFromStripe: jest.fn(),
	updateAccountPlan: jest.fn(),
	findPaidAccountIds: jest.fn(),
}

function managedSub(overrides: Partial<ManagedStripeSubscription>): ManagedStripeSubscription {
	return {
		accountId: 'acc-1',
		subscriptionId: 'sub_1',
		customerId: 'cus_1',
		status: 'active',
		planType: 'pro',
		periodStart: new Date(1_000_000_000_000),
		periodEnd: new Date(1_002_000_000_000),
		cancelAtPeriodEnd: false,
		...overrides,
	}
}

describe('SubscriptionReconcileService', () => {
	let service: SubscriptionReconcileService

	beforeEach(async () => {
		const module = await Test.createTestingModule({
			providers: [
				SubscriptionReconcileService,
				{ provide: StripeService, useValue: stripeServiceMock },
				{ provide: SUBSCRIPTION_REPOSITORY, useValue: repoMock },
			],
		}).compile()

		service = module.get(SubscriptionReconcileService)
		jest.clearAllMocks()
	})

	it('skips and does not touch local state when Stripe is not configured', async () => {
		stripeServiceMock.isConfigured.mockReturnValue(false)

		const result = await service.reconcile()

		expect(result.configured).toBe(false)
		expect(stripeServiceMock.listManagedSubscriptions).not.toHaveBeenCalled()
		expect(repoMock.updateAccountPlan).not.toHaveBeenCalled()
	})

	it('upserts subs, activates paid accounts, keeps past_due, and downgrades stale ones', async () => {
		stripeServiceMock.isConfigured.mockReturnValue(true)
		stripeServiceMock.listManagedSubscriptions.mockResolvedValue([
			managedSub({ accountId: 'acc-active', subscriptionId: 'sub_a', status: 'active' }),
			managedSub({ accountId: 'acc-pastdue', subscriptionId: 'sub_p', status: 'past_due' }),
		])
		repoMock.upsertSubscriptionFromStripe
			.mockResolvedValueOnce('created')
			.mockResolvedValueOnce('updated')
		// 'acc-stale' is paid locally but Stripe no longer reports it as paid.
		repoMock.findPaidAccountIds.mockResolvedValue(['acc-active', 'acc-pastdue', 'acc-stale'])

		const result = await service.reconcile()

		expect(repoMock.upsertSubscriptionFromStripe).toHaveBeenCalledTimes(2)
		// active → ensure plan set; stale → downgrade; past_due → untouched (kept during dunning).
		expect(repoMock.updateAccountPlan).toHaveBeenCalledWith('acc-active', 'pro')
		expect(repoMock.updateAccountPlan).toHaveBeenCalledWith('acc-stale', 'free')
		expect(repoMock.updateAccountPlan).toHaveBeenCalledTimes(2)

		expect(result).toEqual({
			configured: true,
			stripeSubscriptions: 2,
			subscriptionsCreated: 1,
			subscriptionsUpdated: 1,
			accountsKeptPaid: 2,
			accountsDowngraded: 1,
		})
	})

	it('downgrades all locally-paid accounts when Stripe reports none active', async () => {
		stripeServiceMock.isConfigured.mockReturnValue(true)
		stripeServiceMock.listManagedSubscriptions.mockResolvedValue([])
		repoMock.findPaidAccountIds.mockResolvedValue(['acc-x', 'acc-y'])

		const result = await service.reconcile()

		expect(repoMock.updateAccountPlan).toHaveBeenCalledWith('acc-x', 'free')
		expect(repoMock.updateAccountPlan).toHaveBeenCalledWith('acc-y', 'free')
		expect(result.accountsDowngraded).toBe(2)
	})
})
