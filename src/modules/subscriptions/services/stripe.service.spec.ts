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
	customers: { create: jest.fn(), retrieve: jest.fn() },
	checkout: { sessions: { create: jest.fn(), list: jest.fn(), expire: jest.fn() } },
	billingPortal: { sessions: { create: jest.fn() } },
	subscriptions: { cancel: jest.fn(), retrieve: jest.fn(), list: jest.fn() },
	coupons: { retrieve: jest.fn(), create: jest.fn() },
	webhooks: { constructEvent: jest.fn() },
}
jest.mock('stripe', () => jest.fn(() => stripeMock))

/** Mimics the SDK's auto-paginating list result (consumed with `for await`). */
function asyncList<T>(items: T[]) {
	return {
		async *[Symbol.asyncIterator]() {
			for (const item of items) yield item
		},
	}
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const subscriptionRepositoryMock: Record<string, jest.Mock> = {
	findAccountEmailName: jest.fn(),
	updateAccountPlan: jest.fn(),
	updateSubscriptionsByProviderId: jest.fn(),
	findStripeCustomerId: jest.fn(),
	setStripeCustomerIdIfMissing: jest.fn(),
	replaceStripeCustomerId: jest.fn(),
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

	// One Stripe Customer per account (AUDIT-001): reused on every checkout.
	describe('getOrCreateCustomer', () => {
		it('reuses the Customer already stored on the account when it still exists', async () => {
			subscriptionRepositoryMock.findStripeCustomerId.mockResolvedValueOnce('cus_stored')
			stripeMock.customers.retrieve.mockResolvedValueOnce({ id: 'cus_stored' })

			await expect(service.getOrCreateCustomer('acc-1')).resolves.toBe('cus_stored')
			expect(stripeMock.customers.retrieve).toHaveBeenCalledWith('cus_stored')
			expect(stripeMock.customers.create).not.toHaveBeenCalled()
		})

		// AUDIT-011: a stored Customer deleted in Stripe (or from the other Stripe mode)
		// must not break checkout and the portal forever.
		it.each([
			['deleted in Stripe', () => Promise.resolve({ id: 'cus_stored', deleted: true })],
			['missing (other mode)', () => Promise.reject({ code: 'resource_missing' })],
		])('replaces a stored Customer that is %s, with a fresh idempotency key', async (_label, retrieve) => {
			subscriptionRepositoryMock.findStripeCustomerId.mockResolvedValueOnce('cus_stored')
			stripeMock.customers.retrieve.mockImplementationOnce(retrieve)
			subscriptionRepositoryMock.findAccountEmailName.mockResolvedValueOnce({
				email: 'user@test.com',
				name: 'Alice',
			})
			stripeMock.customers.create.mockResolvedValueOnce({ id: 'cus_replacement' })
			subscriptionRepositoryMock.replaceStripeCustomerId.mockResolvedValueOnce('cus_replacement')

			await expect(service.getOrCreateCustomer('acc-1')).resolves.toBe('cus_replacement')

			// Not the original key, which would replay the deleted Customer for 24h.
			const [, options] = stripeMock.customers.create.mock.calls[0]
			expect(options.idempotencyKey).toMatch(/^customer_acc-1_replace_cus_stored_[0-9a-f]{16}$/)
			// Compare-and-swap on the stale value; never the "only if missing" write.
			expect(subscriptionRepositoryMock.replaceStripeCustomerId).toHaveBeenCalledWith(
				'acc-1',
				'cus_stored',
				'cus_replacement',
			)
			expect(subscriptionRepositoryMock.setStripeCustomerIdIfMissing).not.toHaveBeenCalled()
		})

		it('fails closed when verifying the stored Customer errors for another reason', async () => {
			subscriptionRepositoryMock.findStripeCustomerId.mockResolvedValueOnce('cus_stored')
			stripeMock.customers.retrieve.mockRejectedValueOnce(new Error('api down'))

			await expect(service.getOrCreateCustomer('acc-1')).rejects.toThrow('api down')
			expect(stripeMock.customers.create).not.toHaveBeenCalled()
		})

		it('creates the Customer once (idempotent) and stores it on the account', async () => {
			subscriptionRepositoryMock.findStripeCustomerId.mockResolvedValueOnce(null)
			subscriptionRepositoryMock.findAccountEmailName.mockResolvedValueOnce({
				email: 'user@test.com',
				name: 'Alice',
			})
			stripeMock.customers.create.mockResolvedValueOnce({ id: 'cus_new' })
			subscriptionRepositoryMock.setStripeCustomerIdIfMissing.mockResolvedValueOnce('cus_new')

			await expect(service.getOrCreateCustomer('acc-1')).resolves.toBe('cus_new')

			const [params, options] = stripeMock.customers.create.mock.calls[0]
			expect(params).toEqual({
				email: 'user@test.com',
				name: 'Alice',
				metadata: { account_id: 'acc-1' },
			})
			expect(options.idempotencyKey).toMatch(/^customer_acc-1_initial_[0-9a-f]{16}$/)
			expect(subscriptionRepositoryMock.setStripeCustomerIdIfMissing).toHaveBeenCalledWith(
				'acc-1',
				'cus_new',
			)
		})

		it('converges on the Customer a concurrent request stored first', async () => {
			subscriptionRepositoryMock.findStripeCustomerId.mockResolvedValueOnce(null)
			subscriptionRepositoryMock.findAccountEmailName.mockResolvedValueOnce({
				email: 'user@test.com',
				name: 'Alice',
			})
			stripeMock.customers.create.mockResolvedValueOnce({ id: 'cus_mine' })
			subscriptionRepositoryMock.setStripeCustomerIdIfMissing.mockResolvedValueOnce('cus_winner')

			await expect(service.getOrCreateCustomer('acc-1')).resolves.toBe('cus_winner')
		})

		it('fails closed when Stripe errors (checkout must not proceed)', async () => {
			subscriptionRepositoryMock.findStripeCustomerId.mockResolvedValueOnce(null)
			subscriptionRepositoryMock.findAccountEmailName.mockResolvedValueOnce({
				email: 'user@test.com',
				name: 'Alice',
			})
			stripeMock.customers.create.mockRejectedValueOnce(new Error('stripe down'))

			await expect(service.getOrCreateCustomer('acc-1')).rejects.toThrow('stripe down')
			expect(subscriptionRepositoryMock.setStripeCustomerIdIfMissing).not.toHaveBeenCalled()
		})
	})

	describe('listLiveSubscriptions', () => {
		it('returns every non-ended subscription across the Customers (deduplicated)', async () => {
			stripeMock.subscriptions.list
				.mockReturnValueOnce(
					asyncList([
						{ id: 'sub_active', status: 'active' },
						{ id: 'sub_old', status: 'canceled' },
						{ id: 'sub_inc', status: 'incomplete' },
					]),
				)
				.mockReturnValueOnce(
					asyncList([
						{ id: 'sub_unpaid', status: 'unpaid' },
						{ id: 'sub_exp', status: 'incomplete_expired' },
					]),
				)

			const live = await service.listLiveSubscriptions(['cus_a', 'cus_b', 'cus_a'])

			expect(live.map((s) => s.id)).toEqual(['sub_active', 'sub_inc', 'sub_unpaid'])
			expect(stripeMock.subscriptions.list).toHaveBeenCalledTimes(2)
			expect(stripeMock.subscriptions.list).toHaveBeenCalledWith({
				customer: 'cus_a',
				status: 'all',
				limit: 100,
			})
		})

		it('skips a Customer that no longer exists in Stripe', async () => {
			stripeMock.subscriptions.list.mockImplementationOnce(() => {
				throw { code: 'resource_missing' }
			})

			await expect(service.listLiveSubscriptions(['cus_gone'])).resolves.toEqual([])
		})

		it('propagates other Stripe errors (fail closed)', async () => {
			stripeMock.subscriptions.list.mockImplementationOnce(() => {
				throw new Error('api down')
			})

			await expect(service.listLiveSubscriptions(['cus_a'])).rejects.toThrow('api down')
		})
	})

	describe('expireOpenCheckoutSessions', () => {
		it('expires every open session of the Customer', async () => {
			stripeMock.checkout.sessions.list.mockReturnValueOnce(
				asyncList([{ id: 'cs_1' }, { id: 'cs_2' }]),
			)
			stripeMock.checkout.sessions.expire.mockResolvedValue({})

			await expect(service.expireOpenCheckoutSessions('cus_1')).resolves.toBe(2)
			expect(stripeMock.checkout.sessions.list).toHaveBeenCalledWith({
				customer: 'cus_1',
				status: 'open',
				limit: 100,
			})
			expect(stripeMock.checkout.sessions.expire).toHaveBeenCalledWith('cs_1')
			expect(stripeMock.checkout.sessions.expire).toHaveBeenCalledWith('cs_2')
		})
	})

	describe('expireCheckoutSession', () => {
		it('expires the given session', async () => {
			stripeMock.checkout.sessions.expire.mockResolvedValueOnce({})

			await service.expireCheckoutSession('cs_9')

			expect(stripeMock.checkout.sessions.expire).toHaveBeenCalledWith('cs_9')
		})
	})

	describe('cancelSubscription', () => {
		it('cancels in Stripe', async () => {
			stripeMock.subscriptions.cancel.mockResolvedValueOnce({})

			await service.cancelSubscription('sub_inc')

			expect(stripeMock.subscriptions.cancel).toHaveBeenCalledWith('sub_inc')
		})
	})

	describe('createCheckoutSession', () => {
		it('should create a checkout session and return url and sessionId', async () => {
			stripeMock.checkout.sessions.create.mockResolvedValueOnce({
				url: 'https://checkout.stripe.com/session',
				id: 'cs_123',
			})
			const before = Math.floor(Date.now() / 1000)

			const result = await service.createCheckoutSession(
				'acc-1',
				'cus_1',
				'price_123',
				'https://success',
				'https://cancel',
				'pro',
				'attempt-1',
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
			// The account's own Customer, never customer_email (which spawned a new
			// Customer per session and hid existing subscriptions from Stripe).
			expect(params.customer).toBe('cus_1')
			expect(params.customer_email).toBeUndefined()
			// Short-lived session: 30 minutes (Stripe's minimum).
			expect(params.expires_at).toBeGreaterThanOrEqual(before + 35 * 60)
			expect(params.expires_at).toBeLessThanOrEqual(before + 35 * 60 + 5)
			// Per-attempt key: only dedupes the SDK's own retries of THIS request.
			expect(options.idempotencyKey).toBe('checkout_acc-1_attempt-1')
		})

		it('should return null when Stripe rejects the session', async () => {
			stripeMock.checkout.sessions.create.mockRejectedValueOnce(new Error('No such customer'))

			const result = await service.createCheckoutSession(
				'acc-1',
				'cus_gone',
				'price_123',
				'https://s',
				'https://c',
				'pro',
				'attempt-1',
			)

			expect(result).toBeNull()
		})

		// AUDIT-010: a retry is a new attempt with a new key, so it never collides with the
		// previous attempt's key (whose body differed, at least in expires_at).
		it('uses a different idempotency key per attempt', async () => {
			stripeMock.checkout.sessions.create.mockResolvedValue({ url: 'https://c', id: 'cs_1' })

			await service.createCheckoutSession(
				'acc-1',
				'cus_1',
				'price_1',
				'https://s',
				'https://c',
				'pro',
				'attempt-1',
			)
			await service.createCheckoutSession(
				'acc-1',
				'cus_1',
				'price_1',
				'https://s',
				'https://c',
				'pro',
				'attempt-2',
			)

			const keys = stripeMock.checkout.sessions.create.mock.calls.map(
				([, options]) => options.idempotencyKey,
			)
			expect(keys).toEqual(['checkout_acc-1_attempt-1', 'checkout_acc-1_attempt-2'])
		})

		it('should attach a promotional coupon when promo period is active', async () => {
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

			await service.createCheckoutSession(
				'acc-1',
				'cus_1',
				'price_1',
				'https://s',
				'https://c',
				'pro',
				'attempt-1',
			)

			expect(stripeMock.checkout.sessions.create).toHaveBeenCalledWith(
				expect.objectContaining({ discounts: [{ coupon: 'promo_25_off' }] }),
				expect.objectContaining({
					idempotencyKey: 'checkout_acc-1_attempt-1',
				}),
			)
		})

		it('should create the coupon when missing and attach it', async () => {
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

			await service.createCheckoutSession(
				'acc-1',
				'cus_1',
				'price_1',
				'https://s',
				'https://c',
				'pro',
				'attempt-1',
			)

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
					idempotencyKey: 'checkout_acc-1_attempt-1',
				}),
			)
		})

		it('should omit discounts when promo not active', async () => {
			stripeMock.checkout.sessions.create.mockResolvedValueOnce({
				url: 'https://checkout',
				id: 'cs_1',
			})

			await service.createCheckoutSession(
				'acc-1',
				'cus_1',
				'price_1',
				'https://s',
				'https://c',
				'pro',
				'attempt-1',
			)

			const call = stripeMock.checkout.sessions.create.mock.calls[0][0]
			expect(call.discounts).toBeUndefined()
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
