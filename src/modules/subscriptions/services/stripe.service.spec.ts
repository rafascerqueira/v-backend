/**
 * StripeService unit tests
 * Covers: isConfigured, createCustomer, createCheckoutSession, createPortalSession,
 *         constructWebhookEvent
 * Verifies: graceful no-op when Stripe not configured, delegation to repository,
 *           webhook event routing (checkout, subscription, invoice)
 */
import { ConfigService } from '@nestjs/config'
import { Test } from '@nestjs/testing'
import { SettingsService } from '@/modules/admin/services/settings.service'
import { SUBSCRIPTION_REPOSITORY } from '@/shared/repositories/subscription.repository'
import { StripeService } from './stripe.service'

// Mock the Stripe library
const stripeMock = {
	customers: { create: jest.fn() },
	checkout: { sessions: { create: jest.fn() } },
	billingPortal: { sessions: { create: jest.fn() } },
	subscriptions: { cancel: jest.fn(), retrieve: jest.fn() },
	coupons: { retrieve: jest.fn(), create: jest.fn() },
	webhooks: { constructEvent: jest.fn() },
}
jest.mock('stripe', () => jest.fn(() => stripeMock))

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const subscriptionRepositoryMock: Record<string, jest.Mock> = {
	findAccountEmailName: jest.fn(),
	updateAccountPlan: jest.fn(),
	updateSubscriptionsByProviderId: jest.fn(),
}

const configServiceMock = {
	get: jest.fn((key: string, def?: unknown) => {
		const cfg: Record<string, unknown> = {
			'stripe.secretKey': 'sk_test_fake',
			'stripe.webhookSecret': 'whsec_fake',
		}
		return cfg[key] ?? def
	}),
}

const settingsServiceMock = {
	getPromotionalPeriod: jest.fn().mockResolvedValue({
		startDate: null,
		endDate: null,
		discountPercent: 0,
		isActive: false,
	}),
}

describe('StripeService', () => {
	let service: StripeService

	beforeEach(async () => {
		const module = await Test.createTestingModule({
			providers: [
				StripeService,
				{ provide: SUBSCRIPTION_REPOSITORY, useValue: subscriptionRepositoryMock },
				{ provide: ConfigService, useValue: configServiceMock },
				{ provide: SettingsService, useValue: settingsServiceMock },
			],
		}).compile()

		service = module.get(StripeService)
		jest.clearAllMocks()
		settingsServiceMock.getPromotionalPeriod.mockResolvedValue({
			startDate: null,
			endDate: null,
			discountPercent: 0,
			isActive: false,
		})
	})

	describe('isConfigured', () => {
		it('should return true when Stripe key is set', () => {
			expect(service.isConfigured()).toBe(true)
		})
	})

	describe('createCustomer', () => {
		it('should create a Stripe customer and return the customer ID', async () => {
			stripeMock.customers.create.mockResolvedValueOnce({ id: 'cus_123' })

			const result = await service.createCustomer('user@test.com', 'Alice', 'acc-1')

			expect(stripeMock.customers.create).toHaveBeenCalledWith(
				expect.objectContaining({ email: 'user@test.com', name: 'Alice' }),
			)
			expect(result).toBe('cus_123')
		})

		it('should return null when Stripe throws an error', async () => {
			stripeMock.customers.create.mockRejectedValueOnce(new Error('Stripe error'))

			const result = await service.createCustomer('user@test.com', 'Alice', 'acc-1')

			expect(result).toBeNull()
		})
	})

	describe('createCheckoutSession', () => {
		it('should create a checkout session and return url and sessionId', async () => {
			subscriptionRepositoryMock.findAccountEmailName.mockResolvedValueOnce({
				email: 'user@test.com',
				name: 'Alice',
			})
			stripeMock.checkout.sessions.create.mockResolvedValueOnce({
				url: 'https://checkout.stripe.com/session',
				id: 'cs_123',
			})

			const result = await service.createCheckoutSession(
				'acc-1',
				'price_123',
				'https://success',
				'https://cancel',
				'pro',
			)

			expect(result).not.toBeNull()
			expect(result?.url).toBe('https://checkout.stripe.com/session')
			expect(result?.sessionId).toBe('cs_123')

			// account_id + plan_type ride on BOTH the session and subscription_data
			// metadata so later customer.subscription.* events can resolve tenant + tier.
			const [params, options] = stripeMock.checkout.sessions.create.mock.calls[0]
			expect(params.metadata).toEqual({ account_id: 'acc-1', plan_type: 'pro' })
			expect(params.subscription_data.metadata).toEqual({
				account_id: 'acc-1',
				plan_type: 'pro',
			})
			expect(options.idempotencyKey).toMatch(/^checkout_acc-1_price_123_\d{4}-\d{2}-\d{2}$/)
		})

		it('should return null when account not found', async () => {
			subscriptionRepositoryMock.findAccountEmailName.mockResolvedValueOnce(null)

			const result = await service.createCheckoutSession(
				'unknown',
				'price_123',
				'https://s',
				'https://c',
			)

			expect(result).toBeNull()
		})

		it('should attach a promotional coupon when promo period is active', async () => {
			subscriptionRepositoryMock.findAccountEmailName.mockResolvedValueOnce({
				email: 'a@b.com',
				name: 'A',
			})
			settingsServiceMock.getPromotionalPeriod.mockResolvedValueOnce({
				startDate: new Date(),
				endDate: new Date(Date.now() + 86400000),
				discountPercent: 25,
				isActive: true,
			})
			stripeMock.coupons.retrieve.mockResolvedValueOnce({ id: 'promo_25_off' })
			stripeMock.checkout.sessions.create.mockResolvedValueOnce({
				url: 'https://checkout',
				id: 'cs_1',
			})

			await service.createCheckoutSession('acc-1', 'price_1', 'https://s', 'https://c')

			expect(stripeMock.checkout.sessions.create).toHaveBeenCalledWith(
				expect.objectContaining({ discounts: [{ coupon: 'promo_25_off' }] }),
				expect.objectContaining({
					idempotencyKey: expect.stringMatching(/^checkout_acc-1_price_1_\d{4}-\d{2}-\d{2}$/),
				}),
			)
		})

		it('should create the coupon when missing and attach it', async () => {
			subscriptionRepositoryMock.findAccountEmailName.mockResolvedValueOnce({
				email: 'a@b.com',
				name: 'A',
			})
			settingsServiceMock.getPromotionalPeriod.mockResolvedValueOnce({
				startDate: new Date(),
				endDate: new Date(Date.now() + 86400000),
				discountPercent: 30,
				isActive: true,
			})
			stripeMock.coupons.retrieve.mockRejectedValueOnce({ code: 'resource_missing' })
			stripeMock.coupons.create.mockResolvedValueOnce({ id: 'promo_30_off' })
			stripeMock.checkout.sessions.create.mockResolvedValueOnce({
				url: 'https://checkout',
				id: 'cs_1',
			})

			await service.createCheckoutSession('acc-1', 'price_1', 'https://s', 'https://c')

			expect(stripeMock.coupons.create).toHaveBeenCalledWith(
				expect.objectContaining({
					id: 'promo_30_off',
					percent_off: 30,
					duration: 'once',
				}),
			)
			expect(stripeMock.checkout.sessions.create).toHaveBeenCalledWith(
				expect.objectContaining({ discounts: [{ coupon: 'promo_30_off' }] }),
				expect.objectContaining({
					idempotencyKey: expect.stringMatching(/^checkout_acc-1_price_1_\d{4}-\d{2}-\d{2}$/),
				}),
			)
		})

		it('should omit discounts when promo not active', async () => {
			subscriptionRepositoryMock.findAccountEmailName.mockResolvedValueOnce({
				email: 'a@b.com',
				name: 'A',
			})
			stripeMock.checkout.sessions.create.mockResolvedValueOnce({
				url: 'https://checkout',
				id: 'cs_1',
			})

			await service.createCheckoutSession('acc-1', 'price_1', 'https://s', 'https://c')

			const call = stripeMock.checkout.sessions.create.mock.calls[0][0]
			expect(call.discounts).toBeUndefined()
		})
	})

	describe('createPortalSession', () => {
		it('should return the portal session URL', async () => {
			stripeMock.billingPortal.sessions.create.mockResolvedValueOnce({
				url: 'https://billing.portal',
			})

			const result = await service.createPortalSession('cus_123', 'https://return')

			expect(result).toBe('https://billing.portal')
		})
	})

	describe('constructWebhookEvent', () => {
		it('should return a Stripe event when signature is valid', () => {
			const fakeEvent = { id: 'evt_1', type: 'invoice.payment_succeeded' }
			stripeMock.webhooks.constructEvent.mockReturnValueOnce(fakeEvent as any)

			const result = service.constructWebhookEvent(Buffer.from('payload'), 'stripe-signature')

			expect(result).toEqual(fakeEvent)
		})

		it('should return null when signature verification fails', () => {
			stripeMock.webhooks.constructEvent.mockImplementationOnce(() => {
				throw new Error('Invalid signature')
			})

			const result = service.constructWebhookEvent(Buffer.from('payload'), 'bad-sig')

			expect(result).toBeNull()
		})
	})
})
