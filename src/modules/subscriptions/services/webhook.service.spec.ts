/**
 * WebhookService unit tests
 * Covers: processStripeWebhook, processPagSeguroWebhook
 * Verifies: idempotency (already processed), error recording, subscription creation/update,
 *           plan downgrade on cancellation
 */
import { Test } from '@nestjs/testing'
import type Stripe from 'stripe'
import { WEBHOOK_REPOSITORY } from '@/shared/repositories/webhook.repository'
import { SubscriptionService } from './subscription.service'
import { WebhookService } from './webhook.service'

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
	createSubscription: jest.fn(),
	updatePlan: jest.fn(),
	handleSubscriptionEnded: jest.fn(),
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

// Subscription payload as Stripe sends it on API 2026-02-25.clover: the billing
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

// Invoice payload on clover: the subscription link lives under
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
			],
		}).compile()

		service = module.get(WebhookService)
		jest.clearAllMocks()
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
			webhookRepositoryMock.findSubscriptionByProviderId.mockRejectedValueOnce(new Error('DB down'))
			webhookRepositoryMock.markWebhookError.mockResolvedValueOnce(undefined)

			await expect(
				service.processStripeWebhook(
					makeSubEvent('customer.subscription.updated', { metadata: { account_id: 'acc-1' } }),
				),
			).rejects.toThrow('DB down')

			expect(webhookRepositoryMock.markWebhookError).toHaveBeenCalledWith(99, 'DB down')
		})

		it('should update existing subscription on customer.subscription.updated', async () => {
			webhookRepositoryMock.findWebhookEvent.mockResolvedValueOnce(null)
			webhookRepositoryMock.upsertWebhookEvent.mockResolvedValueOnce(mockWebhookRecord as any)
			webhookRepositoryMock.findSubscriptionByProviderId.mockResolvedValueOnce({
				id: 5,
				plan_type: 'pro',
			})
			webhookRepositoryMock.updateSubscriptionById.mockResolvedValueOnce(undefined)
			subscriptionServiceMock.updatePlan.mockResolvedValueOnce(undefined)
			webhookRepositoryMock.markWebhookProcessed.mockResolvedValueOnce(undefined)

			await service.processStripeWebhook(
				makeSubEvent('customer.subscription.updated', {
					metadata: { account_id: 'acc-1', plan_type: 'pro' },
				}),
			)

			expect(webhookRepositoryMock.updateSubscriptionById).toHaveBeenCalledWith(
				5,
				expect.objectContaining({
					status: 'active',
					current_period_start: new Date(PERIOD_START * 1000),
					current_period_end: new Date(PERIOD_END * 1000),
				}),
			)
			expect(subscriptionServiceMock.updatePlan).toHaveBeenCalledWith('acc-1', 'pro')
		})

		it('should create new subscription when provider ID not found', async () => {
			webhookRepositoryMock.findWebhookEvent.mockResolvedValueOnce(null)
			webhookRepositoryMock.upsertWebhookEvent.mockResolvedValueOnce(mockWebhookRecord as any)
			webhookRepositoryMock.findSubscriptionByProviderId.mockResolvedValueOnce(null)
			subscriptionServiceMock.createSubscription.mockResolvedValueOnce(undefined)
			subscriptionServiceMock.updatePlan.mockResolvedValueOnce(undefined)
			webhookRepositoryMock.markWebhookProcessed.mockResolvedValueOnce(undefined)

			await service.processStripeWebhook(
				makeSubEvent('customer.subscription.created', {
					id: 'sub_new',
					metadata: { account_id: 'acc-1', plan_type: 'pro' },
				}),
			)

			expect(subscriptionServiceMock.createSubscription).toHaveBeenCalledWith(
				expect.objectContaining({
					periodStart: new Date(PERIOD_START * 1000),
					periodEnd: new Date(PERIOD_END * 1000),
				}),
			)
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
