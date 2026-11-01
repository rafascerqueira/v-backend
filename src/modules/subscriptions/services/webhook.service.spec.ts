/**
 * WebhookService unit tests
 * Covers: processStripeWebhook, processPagSeguroWebhook
 * Verifies: idempotency (already processed), error recording, subscription creation/update,
 *           plan downgrade on cancellation
 */
import { Test } from '@nestjs/testing'
import type Stripe from 'stripe'
import { WEBHOOK_REPOSITORY } from '@/shared/repositories/webhook.repository'
import { StripeService } from './stripe.service'
import { SubscriptionService } from './subscription.service'
import { mapStripeStatus, WebhookService } from './webhook.service'

const webhookRepositoryMock: Record<string, jest.Mock> = {
	findWebhookEvent: jest.fn(),
	upsertWebhookEvent: jest.fn(),
	markWebhookProcessed: jest.fn(),
	markWebhookError: jest.fn(),
	findSubscriptionByProviderId: jest.fn(),
	updateSubscriptionById: jest.fn(),
	updateSubscriptionsByProviderId: jest.fn(),
}

const subscriptionServiceMock = {
	syncStripeSubscription: jest.fn(),
	updatePlan: jest.fn(),
	handleSubscriptionEnded: jest.fn(),
	getActiveSubscription: jest.fn(),
}

// resolvePlanType's own price→tier logic is covered in stripe.service.spec; here we
// only check the webhook feeds it the right inputs and uses its answer.
const stripeServiceMock = {
	retrieveSubscription: jest.fn(),
	resolvePlanType: jest.fn(),
}

const mockWebhookRecord = { id: 99, processed: false }

const PERIOD_START = 1_000_000
const PERIOD_END = 2_000_000

function makeEventEnvelope(type: string, object: Record<string, unknown>): Stripe.Event {
	return {
		id: 'evt_test',
		type,
		api_version: '2026-03-25.dahlia',
		created: 0,
		livemode: false,
		pending_webhooks: 0,
		request: null,
		object: 'event',
		data: { object: object as any },
	} as unknown as Stripe.Event
}

// Subscription payload as Stripe sends it on API 2026-03-25.dahlia: the billing
// period lives on the subscription item, NOT at the top level of the subscription.
function makeSubEvent(type: string, overrides: Record<string, unknown> = {}): Stripe.Event {
	return makeEventEnvelope(type, {
		id: 'sub_1',
		customer: 'cus_1',
		status: 'active',
		cancel_at_period_end: false,
		items: { data: [{ current_period_start: PERIOD_START, current_period_end: PERIOD_END }] },
		metadata: {},
		...overrides,
	})
}

// Invoice payload on dahlia: the subscription link lives under
// parent.subscription_details.subscription, NOT at the top level of the invoice.
function makeInvoiceEvent(type: string, overrides: Record<string, unknown> = {}): Stripe.Event {
	return makeEventEnvelope(type, {
		object: 'invoice',
		period_start: PERIOD_START,
		period_end: PERIOD_END,
		parent: { subscription_details: { subscription: 'sub_inv_1' } },
		...overrides,
	})
}

describe('WebhookService', () => {
	let service: WebhookService

	beforeEach(async () => {
		const module = await Test.createTestingModule({
			providers: [
				WebhookService,
				{ provide: WEBHOOK_REPOSITORY, useValue: webhookRepositoryMock },
				{ provide: SubscriptionService, useValue: subscriptionServiceMock },
				{ provide: StripeService, useValue: stripeServiceMock },
			],
		}).compile()

		service = module.get(WebhookService)
		jest.resetAllMocks()
		// Defaults: Stripe unconfigured (handler falls back to the payload); tier = pro;
		// no other active subscription on the account.
		stripeServiceMock.retrieveSubscription.mockResolvedValue(null)
		stripeServiceMock.resolvePlanType.mockReturnValue('pro')
		subscriptionServiceMock.getActiveSubscription.mockResolvedValue(null)
	})

	describe('processStripeWebhook', () => {
		it('should skip processing and return already processed when event was already handled', async () => {
			webhookRepositoryMock.findWebhookEvent.mockResolvedValueOnce({ processed: true } as any)

			const result = await service.processStripeWebhook(makeSubEvent('invoice.payment_succeeded'))

			expect(result.message).toBe('Already processed')
			expect(webhookRepositoryMock.upsertWebhookEvent).not.toHaveBeenCalled()
		})

		it('should store event, process it, and mark as processed on success', async () => {
			webhookRepositoryMock.findWebhookEvent.mockResolvedValueOnce(null)
			webhookRepositoryMock.upsertWebhookEvent.mockResolvedValueOnce(mockWebhookRecord as any)
			webhookRepositoryMock.markWebhookProcessed.mockResolvedValueOnce(undefined)

			const result = await service.processStripeWebhook(makeSubEvent('invoice.payment_succeeded'))

			expect(webhookRepositoryMock.upsertWebhookEvent).toHaveBeenCalledWith(
				expect.objectContaining({ provider: 'stripe' }),
			)
			expect(webhookRepositoryMock.markWebhookProcessed).toHaveBeenCalledWith(99)
			expect(result.success).toBe(true)
		})

		it('should record error and re-throw when handler fails', async () => {
			webhookRepositoryMock.findWebhookEvent.mockResolvedValueOnce(null)
			webhookRepositoryMock.upsertWebhookEvent.mockResolvedValueOnce(mockWebhookRecord as any)
			subscriptionServiceMock.syncStripeSubscription.mockRejectedValueOnce(new Error('DB down'))
			webhookRepositoryMock.markWebhookError.mockResolvedValueOnce(undefined)

			await expect(
				service.processStripeWebhook(
					makeSubEvent('customer.subscription.updated', { metadata: { account_id: 'acc-1' } }),
				),
			).rejects.toThrow('DB down')

			expect(webhookRepositoryMock.markWebhookError).toHaveBeenCalledWith(99, 'DB down')
		})

		it('should sync the subscription (upsert) and grant the plan on an active update', async () => {
			webhookRepositoryMock.findWebhookEvent.mockResolvedValueOnce(null)
			webhookRepositoryMock.upsertWebhookEvent.mockResolvedValueOnce(mockWebhookRecord as any)

			await service.processStripeWebhook(
				makeSubEvent('customer.subscription.updated', {
					metadata: { account_id: 'acc-1', plan_type: 'pro' },
				}),
			)

			expect(subscriptionServiceMock.syncStripeSubscription).toHaveBeenCalledWith({
				account_id: 'acc-1',
				plan_type: 'pro',
				status: 'active',
				provider_subscription_id: 'sub_1',
				provider_customer_id: 'cus_1',
				current_period_start: new Date(PERIOD_START * 1000),
				current_period_end: new Date(PERIOD_END * 1000),
				cancel_at_period_end: false,
				trial_start: null,
				trial_end: null,
			})
			expect(subscriptionServiceMock.updatePlan).toHaveBeenCalledWith('acc-1', 'pro')
		})

		it('should pass null periods (not invented dates) when the item period is missing', async () => {
			webhookRepositoryMock.findWebhookEvent.mockResolvedValueOnce(null)
			webhookRepositoryMock.upsertWebhookEvent.mockResolvedValueOnce(mockWebhookRecord as any)

			await service.processStripeWebhook(
				makeSubEvent('customer.subscription.created', {
					id: 'sub_new',
					items: { data: [{}] },
					metadata: { account_id: 'acc-1' },
				}),
			)

			expect(subscriptionServiceMock.syncStripeSubscription).toHaveBeenCalledWith(
				expect.objectContaining({
					provider_subscription_id: 'sub_new',
					current_period_start: null,
					current_period_end: null,
				}),
			)
		})

		it('should take trial_start/trial_end from Stripe, not from "now"', async () => {
			webhookRepositoryMock.findWebhookEvent.mockResolvedValueOnce(null)
			webhookRepositoryMock.upsertWebhookEvent.mockResolvedValueOnce(mockWebhookRecord as any)

			await service.processStripeWebhook(
				makeSubEvent('customer.subscription.updated', {
					status: 'trialing',
					trial_start: 1_500_000,
					trial_end: 1_900_000,
					metadata: { account_id: 'acc-1' },
				}),
			)

			expect(subscriptionServiceMock.syncStripeSubscription).toHaveBeenCalledWith(
				expect.objectContaining({
					status: 'trialing',
					trial_start: new Date(1_500_000 * 1000),
					trial_end: new Date(1_900_000 * 1000),
				}),
			)
		})

		it('should use the live Stripe state, so a delayed event cannot roll the status back', async () => {
			webhookRepositoryMock.findWebhookEvent.mockResolvedValueOnce(null)
			webhookRepositoryMock.upsertWebhookEvent.mockResolvedValueOnce(mockWebhookRecord as any)
			// The (late) event says incomplete, but Stripe now reports the sub as active.
			stripeServiceMock.retrieveSubscription.mockResolvedValueOnce({
				id: 'sub_1',
				customer: { id: 'cus_1' },
				status: 'active',
				cancel_at_period_end: false,
				items: {
					data: [
						{
							current_period_start: PERIOD_START,
							current_period_end: PERIOD_END,
							price: { id: 'price_ent' },
						},
					],
				},
				metadata: { account_id: 'acc-1', plan_type: 'pro' },
			})
			stripeServiceMock.resolvePlanType.mockReturnValueOnce('enterprise')

			await service.processStripeWebhook(
				makeSubEvent('customer.subscription.created', {
					status: 'incomplete',
					metadata: { account_id: 'acc-1', plan_type: 'pro' },
				}),
			)

			expect(stripeServiceMock.retrieveSubscription).toHaveBeenCalledWith('sub_1')
			// Tier is resolved from the billed price of the LIVE subscription.
			expect(stripeServiceMock.resolvePlanType).toHaveBeenCalledWith({
				priceId: 'price_ent',
				metadataPlanType: 'pro',
			})
			expect(subscriptionServiceMock.syncStripeSubscription).toHaveBeenCalledWith(
				expect.objectContaining({
					status: 'active',
					plan_type: 'enterprise',
					provider_customer_id: 'cus_1',
				}),
			)
			expect(subscriptionServiceMock.updatePlan).toHaveBeenCalledWith('acc-1', 'enterprise')
		})

		it('should mark subscription active and advance period on invoice.payment_succeeded', async () => {
			webhookRepositoryMock.findWebhookEvent.mockResolvedValueOnce(null)
			webhookRepositoryMock.upsertWebhookEvent.mockResolvedValueOnce(mockWebhookRecord as any)
			webhookRepositoryMock.updateSubscriptionsByProviderId.mockResolvedValueOnce(undefined)
			webhookRepositoryMock.markWebhookProcessed.mockResolvedValueOnce(undefined)

			await service.processStripeWebhook(makeInvoiceEvent('invoice.payment_succeeded'))

			// Reads the subscription id from parent.subscription_details, not the
			// removed top-level invoice.subscription.
			expect(webhookRepositoryMock.updateSubscriptionsByProviderId).toHaveBeenCalledWith(
				'sub_inv_1',
				{
					status: 'active',
					current_period_start: new Date(PERIOD_START * 1000),
					current_period_end: new Date(PERIOD_END * 1000),
				},
			)
		})

		it('should mark subscription past_due on invoice.payment_failed', async () => {
			webhookRepositoryMock.findWebhookEvent.mockResolvedValueOnce(null)
			webhookRepositoryMock.upsertWebhookEvent.mockResolvedValueOnce(mockWebhookRecord as any)
			webhookRepositoryMock.updateSubscriptionsByProviderId.mockResolvedValueOnce(undefined)
			webhookRepositoryMock.markWebhookProcessed.mockResolvedValueOnce(undefined)

			await service.processStripeWebhook(makeInvoiceEvent('invoice.payment_failed'))

			expect(webhookRepositoryMock.updateSubscriptionsByProviderId).toHaveBeenCalledWith(
				'sub_inv_1',
				{
					status: 'past_due',
				},
			)
		})

		it('should no-op an invoice event with no subscription link', async () => {
			webhookRepositoryMock.findWebhookEvent.mockResolvedValueOnce(null)
			webhookRepositoryMock.upsertWebhookEvent.mockResolvedValueOnce(mockWebhookRecord as any)
			webhookRepositoryMock.markWebhookProcessed.mockResolvedValueOnce(undefined)

			await service.processStripeWebhook(
				makeInvoiceEvent('invoice.payment_succeeded', { parent: null }),
			)

			expect(webhookRepositoryMock.updateSubscriptionsByProviderId).not.toHaveBeenCalled()
		})

		it('should downgrade to free on customer.subscription.deleted', async () => {
			webhookRepositoryMock.findWebhookEvent.mockResolvedValueOnce(null)
			webhookRepositoryMock.upsertWebhookEvent.mockResolvedValueOnce(mockWebhookRecord as any)
			webhookRepositoryMock.updateSubscriptionsByProviderId.mockResolvedValueOnce(undefined)
			subscriptionServiceMock.handleSubscriptionEnded.mockResolvedValueOnce(undefined)
			webhookRepositoryMock.markWebhookProcessed.mockResolvedValueOnce(undefined)

			await service.processStripeWebhook(
				makeSubEvent('customer.subscription.deleted', {
					id: 'sub_old',
					status: 'canceled',
					metadata: { account_id: 'acc-1' },
				}),
			)

			expect(subscriptionServiceMock.handleSubscriptionEnded).toHaveBeenCalledWith('acc-1')
		})

		it('should keep the plan when the account still has another active subscription', async () => {
			webhookRepositoryMock.findWebhookEvent.mockResolvedValueOnce(null)
			webhookRepositoryMock.upsertWebhookEvent.mockResolvedValueOnce(mockWebhookRecord as any)
			subscriptionServiceMock.getActiveSubscription.mockResolvedValueOnce({
				id: 2,
				status: 'active',
			})

			await service.processStripeWebhook(
				makeSubEvent('customer.subscription.deleted', {
					id: 'sub_abandoned',
					status: 'canceled',
					metadata: { account_id: 'acc-1' },
				}),
			)

			expect(webhookRepositoryMock.updateSubscriptionsByProviderId).toHaveBeenCalledWith(
				'sub_abandoned',
				expect.objectContaining({ status: 'canceled' }),
			)
			expect(subscriptionServiceMock.handleSubscriptionEnded).not.toHaveBeenCalled()
		})
	})

	describe('mapStripeStatus', () => {
		it.each([
			['active', 'active'],
			['trialing', 'trialing'],
			['past_due', 'past_due'],
			['unpaid', 'past_due'],
			['incomplete', 'past_due'],
			['canceled', 'canceled'],
			['incomplete_expired', 'canceled'],
			['paused', 'paused'],
		])('%s → %s', (stripeStatus, expected) => {
			expect(mapStripeStatus(stripeStatus)).toBe(expected)
		})
	})

	// A live Stripe subscription as `retrieve` returns it (dahlia shape).
	function liveSub(overrides: Record<string, unknown> = {}) {
		return {
			id: 'sub_live',
			customer: 'cus_1',
			status: 'active',
			cancel_at_period_end: false,
			items: {
				data: [
					{
						current_period_start: PERIOD_START,
						current_period_end: PERIOD_END,
						price: { id: 'price_pro' },
					},
				],
			},
			metadata: { account_id: 'acc-1', plan_type: 'pro' },
			trial_start: null,
			trial_end: null,
			...overrides,
		}
	}

	function freshEvent() {
		webhookRepositoryMock.findWebhookEvent.mockResolvedValueOnce(null)
		webhookRepositoryMock.upsertWebhookEvent.mockResolvedValueOnce(mockWebhookRecord as any)
	}

	describe('checkout.session.completed grants only what is actually paid', () => {
		it('does not grant on an unpaid (async) completion', async () => {
			freshEvent()

			await service.processStripeWebhook(
				makeEventEnvelope('checkout.session.completed', {
					payment_status: 'unpaid',
					subscription: 'sub_live',
					metadata: { account_id: 'acc-1', plan_type: 'pro' },
				}),
			)

			expect(subscriptionServiceMock.updatePlan).not.toHaveBeenCalled()
			expect(stripeServiceMock.retrieveSubscription).not.toHaveBeenCalled()
		})

		it('grants from the live subscription (records the row, tier from price)', async () => {
			freshEvent()
			stripeServiceMock.retrieveSubscription.mockResolvedValueOnce(liveSub())

			await service.processStripeWebhook(
				makeEventEnvelope('checkout.session.completed', {
					payment_status: 'paid',
					subscription: 'sub_live',
					metadata: { account_id: 'acc-1', plan_type: 'pro' },
				}),
			)

			expect(stripeServiceMock.retrieveSubscription).toHaveBeenCalledWith('sub_live')
			expect(subscriptionServiceMock.syncStripeSubscription).toHaveBeenCalledWith(
				expect.objectContaining({ provider_subscription_id: 'sub_live', status: 'active' }),
			)
			expect(subscriptionServiceMock.updatePlan).toHaveBeenCalledWith('acc-1', 'pro')
		})

		it('a retried completion for a subscription canceled meanwhile does NOT re-grant', async () => {
			freshEvent()
			stripeServiceMock.retrieveSubscription.mockResolvedValueOnce(liveSub({ status: 'canceled' }))

			await service.processStripeWebhook(
				makeEventEnvelope('checkout.session.completed', {
					payment_status: 'paid',
					subscription: 'sub_live',
					metadata: { account_id: 'acc-1', plan_type: 'pro' },
				}),
			)

			expect(subscriptionServiceMock.syncStripeSubscription).toHaveBeenCalledWith(
				expect.objectContaining({ status: 'canceled' }),
			)
			expect(subscriptionServiceMock.updatePlan).not.toHaveBeenCalled()
		})
	})

	describe('invoice events re-sync from the live subscription', () => {
		it('a late payment_succeeded cannot resurrect a canceled subscription as active', async () => {
			freshEvent()
			stripeServiceMock.retrieveSubscription.mockResolvedValueOnce(
				liveSub({ id: 'sub_inv_1', status: 'canceled' }),
			)

			await service.processStripeWebhook(makeInvoiceEvent('invoice.payment_succeeded'))

			expect(stripeServiceMock.retrieveSubscription).toHaveBeenCalledWith('sub_inv_1')
			expect(subscriptionServiceMock.syncStripeSubscription).toHaveBeenCalledWith(
				expect.objectContaining({ provider_subscription_id: 'sub_inv_1', status: 'canceled' }),
			)
			// No blind 'active' write from the invoice payload, and no plan grant.
			expect(webhookRepositoryMock.updateSubscriptionsByProviderId).not.toHaveBeenCalled()
			expect(subscriptionServiceMock.updatePlan).not.toHaveBeenCalled()
		})

		it('payment_failed stores the live past_due state without touching the plan', async () => {
			freshEvent()
			stripeServiceMock.retrieveSubscription.mockResolvedValueOnce(
				liveSub({ id: 'sub_inv_1', status: 'past_due' }),
			)

			await service.processStripeWebhook(makeInvoiceEvent('invoice.payment_failed'))

			expect(subscriptionServiceMock.syncStripeSubscription).toHaveBeenCalledWith(
				expect.objectContaining({ status: 'past_due' }),
			)
			expect(subscriptionServiceMock.updatePlan).not.toHaveBeenCalled()
		})
	})

	// Metadata is client-influenced and frozen at checkout. Whatever is in it must never
	// reach the PlanType enum unless it is an exact paid tier.
	describe('plan_type metadata sanitization', () => {
		function processedOk() {
			webhookRepositoryMock.findWebhookEvent.mockResolvedValueOnce(null)
			webhookRepositoryMock.upsertWebhookEvent.mockResolvedValueOnce(mockWebhookRecord as any)
			webhookRepositoryMock.markWebhookProcessed.mockResolvedValueOnce(undefined)
		}

		it.each([
			['enterprise', 'enterprise'],
			['pro', 'pro'],
			['[pro]', 'pro'],
			['free', 'pro'],
			[undefined, 'pro'],
		])('checkout.session.completed with plan_type %p upgrades to %s', async (raw, expected) => {
			processedOk()

			await service.processStripeWebhook(
				makeEventEnvelope('checkout.session.completed', {
					metadata: { account_id: 'acc-1', ...(raw === undefined ? {} : { plan_type: raw }) },
				}),
			)

			expect(subscriptionServiceMock.updatePlan).toHaveBeenCalledWith('acc-1', expected)
		})

		it('customer.subscription.* hands raw metadata to resolvePlanType (which validates it)', async () => {
			processedOk()

			await service.processStripeWebhook(
				makeSubEvent('customer.subscription.updated', {
					metadata: { account_id: 'acc-1', plan_type: '["pro"]' },
				}),
			)

			expect(stripeServiceMock.resolvePlanType).toHaveBeenCalledWith({
				priceId: undefined,
				metadataPlanType: '["pro"]',
			})
			expect(subscriptionServiceMock.updatePlan).toHaveBeenCalledWith('acc-1', 'pro')
		})
	})

	describe('plan grant only for paying statuses', () => {
		it.each([
			'incomplete',
			'unpaid',
			'past_due',
			'incomplete_expired',
		])('a first-seen %s subscription is recorded without the webhook granting the plan', async (status) => {
			webhookRepositoryMock.findWebhookEvent.mockResolvedValueOnce(null)
			webhookRepositoryMock.upsertWebhookEvent.mockResolvedValueOnce(mockWebhookRecord as any)
			webhookRepositoryMock.markWebhookProcessed.mockResolvedValueOnce(undefined)

			await service.processStripeWebhook(
				makeSubEvent('customer.subscription.created', {
					status,
					metadata: { account_id: 'acc-1', plan_type: 'pro' },
				}),
			)

			expect(subscriptionServiceMock.syncStripeSubscription).toHaveBeenCalledWith(
				expect.objectContaining({ status: mapStripeStatus(status) }),
			)
			expect(subscriptionServiceMock.updatePlan).not.toHaveBeenCalled()
		})
	})

	describe('processPagSeguroWebhook', () => {
		it('should skip when already processed', async () => {
			webhookRepositoryMock.findWebhookEvent.mockResolvedValueOnce({ processed: true } as any)

			const result = await service.processPagSeguroWebhook({
				id: 'ps_1',
				type: 'SUBSCRIPTION.RENEWED',
				data: { id: 's1', reference_id: 'acc-1', status: 'ACTIVE' },
			})

			expect(result.message).toBe('Already processed')
		})

		it('should process SUBSCRIPTION.ACTIVATED and mark as processed', async () => {
			webhookRepositoryMock.findWebhookEvent.mockResolvedValueOnce(null)
			webhookRepositoryMock.upsertWebhookEvent.mockResolvedValueOnce(mockWebhookRecord as any)
			webhookRepositoryMock.findSubscriptionByProviderId.mockResolvedValueOnce({
				id: 5,
				plan_type: 'pro',
			})
			webhookRepositoryMock.updateSubscriptionById.mockResolvedValueOnce(undefined)
			subscriptionServiceMock.updatePlan.mockResolvedValueOnce(undefined)
			webhookRepositoryMock.markWebhookProcessed.mockResolvedValueOnce(undefined)

			const result = await service.processPagSeguroWebhook({
				id: 'ps_2',
				type: 'SUBSCRIPTION.ACTIVATED',
				data: { id: 'sub_ps_1', reference_id: 'acc-1', status: 'ACTIVE' },
			})

			expect(result.success).toBe(true)
			expect(webhookRepositoryMock.markWebhookProcessed).toHaveBeenCalledWith(99)
		})

		it('should downgrade to free on SUBSCRIPTION.CANCELED', async () => {
			webhookRepositoryMock.findWebhookEvent.mockResolvedValueOnce(null)
			webhookRepositoryMock.upsertWebhookEvent.mockResolvedValueOnce(mockWebhookRecord as any)
			webhookRepositoryMock.updateSubscriptionsByProviderId.mockResolvedValueOnce(undefined)
			subscriptionServiceMock.handleSubscriptionEnded.mockResolvedValueOnce(undefined)
			webhookRepositoryMock.markWebhookProcessed.mockResolvedValueOnce(undefined)

			await service.processPagSeguroWebhook({
				id: 'ps_3',
				type: 'SUBSCRIPTION.CANCELED',
				data: { id: 'sub_ps_2', reference_id: 'acc-1', status: 'CANCELED' },
			})

			expect(subscriptionServiceMock.handleSubscriptionEnded).toHaveBeenCalledWith('acc-1')
		})
	})
})
