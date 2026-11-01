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
			'stripe.priceIds.pro': 'price_pro_cfg',
			'stripe.priceIds.enterprise': 'price_ent_cfg',
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
			expect(options.idempotencyKey).toMatch(/^checkout_acc-1_[0-9a-f]{16}_\d+$/)
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
					idempotencyKey: expect.stringMatching(/^checkout_acc-1_[0-9a-f]{16}_\d+$/),
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
					idempotencyKey: expect.stringMatching(/^checkout_acc-1_[0-9a-f]{16}_\d+$/),
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

	// Stripe answers idempotency_error when a key is reused with different parameters,
	// so the key must follow the parameters (promo flip, email change, tier change).
	describe('checkoutIdempotencyKey', () => {
		const base = {
			mode: 'subscription' as const,
			line_items: [{ price: 'price_pro', quantity: 1 }],
			customer_email: 'a@b.com',
			metadata: { account_id: 'acc-1', plan_type: 'pro' },
		}
		const t0 = new Date('2026-07-15T10:00:00Z')

		it('is stable for identical parameters inside the same window (double-submit)', () => {
			const later = new Date(t0.getTime() + 60_000)
			expect(service.checkoutIdempotencyKey('acc-1', base, t0)).toBe(
				service.checkoutIdempotencyKey('acc-1', { ...base }, later),
			)
		})

		it('changes when the promo coupon appears between attempts', () => {
			const withCoupon = { ...base, discounts: [{ coupon: 'promo_20_off' }] }
			expect(service.checkoutIdempotencyKey('acc-1', base, t0)).not.toBe(
				service.checkoutIdempotencyKey('acc-1', withCoupon, t0),
			)
		})

		it('changes when the email or the price changes', () => {
			const key = service.checkoutIdempotencyKey('acc-1', base, t0)
			expect(
				service.checkoutIdempotencyKey('acc-1', { ...base, customer_email: 'x@y.com' }, t0),
			).not.toBe(key)
			expect(
				service.checkoutIdempotencyKey(
					'acc-1',
					{ ...base, line_items: [{ price: 'price_ent', quantity: 1 }] },
					t0,
				),
			).not.toBe(key)
		})

		it('changes in the next window, so a later retry gets a fresh session', () => {
			const nextWindow = new Date(t0.getTime() + 11 * 60_000)
			expect(service.checkoutIdempotencyKey('acc-1', base, t0)).not.toBe(
				service.checkoutIdempotencyKey('acc-1', base, nextWindow),
			)
		})

		it('is scoped per account', () => {
			expect(service.checkoutIdempotencyKey('acc-1', base, t0)).not.toBe(
				service.checkoutIdempotencyKey('acc-2', base, t0),
			)
		})
	})

	describe('resolvePlanType', () => {
		it('resolves the tier from the billed price (survives a portal plan switch)', () => {
			expect(
				service.resolvePlanType({ priceId: 'price_pro_cfg', metadataPlanType: 'enterprise' }),
			).toBe('pro')
			expect(service.resolvePlanType({ priceId: 'price_ent_cfg', metadataPlanType: 'pro' })).toBe(
				'enterprise',
			)
		})

		it('falls back to a validated metadata tier for an unmapped price', () => {
			expect(
				service.resolvePlanType({ priceId: 'price_legacy', metadataPlanType: 'enterprise' }),
			).toBe('enterprise')
		})

		it.each([
			['[pro]'],
			['free'],
			['__proto__'],
			[undefined],
			[42],
		])('never lets dirty metadata %p through: falls back to pro', (metadataPlanType) => {
			expect(service.resolvePlanType({ priceId: null, metadataPlanType })).toBe('pro')
		})
	})

	describe('retrieveSubscription', () => {
		it('reads the live subscription from Stripe', async () => {
			stripeMock.subscriptions.retrieve.mockResolvedValueOnce({ id: 'sub_1', status: 'active' })

			await expect(service.retrieveSubscription('sub_1')).resolves.toMatchObject({
				status: 'active',
			})
			expect(stripeMock.subscriptions.retrieve).toHaveBeenCalledWith('sub_1')
		})

		it('propagates Stripe API errors so the webhook is retried', async () => {
			stripeMock.subscriptions.retrieve.mockRejectedValueOnce(new Error('api down'))

			await expect(service.retrieveSubscription('sub_1')).rejects.toThrow('api down')
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
