/**
 * CheckoutService unit tests (AUDIT-001: at most one paid subscription per account)
 * Verifies: per-account lock, local + LIVE Stripe checks, open sessions expired before
 *           the live check, incomplete attempts (recent → wait, own only), per-attempt
 *           idempotency, lock re-checked after create, fail-closed, lock always released.
 */
import { ConflictException, InternalServerErrorException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Test } from '@nestjs/testing'
import { RedisService } from '@/shared/redis/redis.service'
import { SUBSCRIPTION_REPOSITORY } from '@/shared/repositories/subscription.repository'
import { CHECKOUT_LOCK_TTL_MS, CheckoutService, INCOMPLETE_GRACE_MS } from './checkout.service'
import { StripeService } from './stripe.service'
import { SubscriptionService } from './subscription.service'

const subscriptionServiceMock = { hasBlockingSubscription: jest.fn() }

const stripeServiceMock = {
	isConfigured: jest.fn(),
	getOrCreateCustomer: jest.fn(),
	listLiveSubscriptions: jest.fn(),
	cancelSubscription: jest.fn(),
	expireOpenCheckoutSessions: jest.fn(),
	expireCheckoutSession: jest.fn(),
	createCheckoutSession: jest.fn(),
}

const redisServiceMock = {
	acquireLock: jest.fn(),
	releaseLock: jest.fn(),
	isLockHeld: jest.fn(),
}

const repositoryMock = { findProviderCustomerIds: jest.fn() }

const CONFIG: Record<string, string> = {
	'stripe.priceIds.pro': 'price_pro',
	'stripe.priceIds.enterprise': 'price_ent',
	frontendUrl: 'https://app.test',
}
const configServiceMock = {
	get: jest.fn((key: string): string | undefined => CONFIG[key]),
}

const nowSeconds = () => Math.floor(Date.now() / 1000)

describe('CheckoutService', () => {
	let service: CheckoutService

	beforeEach(async () => {
		const module = await Test.createTestingModule({
			providers: [
				CheckoutService,
				{ provide: SubscriptionService, useValue: subscriptionServiceMock },
				{ provide: StripeService, useValue: stripeServiceMock },
				{ provide: RedisService, useValue: redisServiceMock },
				{ provide: ConfigService, useValue: configServiceMock },
				{ provide: SUBSCRIPTION_REPOSITORY, useValue: repositoryMock },
			],
		}).compile()

		service = module.get(CheckoutService)
		jest.clearAllMocks()

		// Happy-path defaults: lock free and kept, nothing known locally or live.
		stripeServiceMock.isConfigured.mockReturnValue(true)
		redisServiceMock.acquireLock.mockResolvedValue('token-1')
		redisServiceMock.releaseLock.mockResolvedValue(true)
		redisServiceMock.isLockHeld.mockResolvedValue(true)
		subscriptionServiceMock.hasBlockingSubscription.mockResolvedValue(false)
		stripeServiceMock.getOrCreateCustomer.mockResolvedValue('cus_1')
		repositoryMock.findProviderCustomerIds.mockResolvedValue([])
		stripeServiceMock.listLiveSubscriptions.mockResolvedValue([])
		stripeServiceMock.expireOpenCheckoutSessions.mockResolvedValue(0)
		stripeServiceMock.createCheckoutSession.mockResolvedValue({
			url: 'https://pay',
			sessionId: 'cs_new',
		})
	})

	function expectLockReleased() {
		expect(redisServiceMock.releaseLock).toHaveBeenCalledWith('checkout-lock:acc-1', 'token-1')
	}

	function expectNoSession() {
		expect(stripeServiceMock.createCheckoutSession).not.toHaveBeenCalled()
	}

	it('opens a session for the account Customer with a per-attempt idempotency key', async () => {
		await expect(service.startCheckout('acc-1', 'pro')).resolves.toEqual({ url: 'https://pay' })

		expect(redisServiceMock.acquireLock).toHaveBeenCalledWith(
			'checkout-lock:acc-1',
			CHECKOUT_LOCK_TTL_MS,
		)
		expect(stripeServiceMock.createCheckoutSession).toHaveBeenCalledWith(
			'acc-1',
			'cus_1',
			'price_pro',
			'https://app.test/plans?checkout=success',
			'https://app.test/plans?checkout=canceled',
			'pro',
			'token-1', // the lock token scopes the idempotency key to this attempt
		)
		expectLockReleased()
	})

	// AUDIT-012: a session paid between "expire" and "live check" must be seen as live.
	it('expires older open sessions BEFORE the live check, and both before create', async () => {
		await service.startCheckout('acc-1', 'pro')

		const expireOrder = stripeServiceMock.expireOpenCheckoutSessions.mock.invocationCallOrder[0]
		const listOrder = stripeServiceMock.listLiveSubscriptions.mock.invocationCallOrder[0]
		const createOrder = stripeServiceMock.createCheckoutSession.mock.invocationCallOrder[0]
		expect(stripeServiceMock.expireOpenCheckoutSessions).toHaveBeenCalledWith('cus_1')
		expect(expireOrder).toBeLessThan(listOrder)
		expect(listOrder).toBeLessThan(createOrder)
	})

	it('also checks legacy Customers seen on the account rows', async () => {
		repositoryMock.findProviderCustomerIds.mockResolvedValueOnce(['cus_old_1', 'cus_old_2'])

		await service.startCheckout('acc-1', 'pro')

		expect(stripeServiceMock.listLiveSubscriptions).toHaveBeenCalledWith([
			'cus_1',
			'cus_old_1',
			'cus_old_2',
		])
	})

	it('409 CHECKOUT_IN_PROGRESS when another checkout of the account holds the lock', async () => {
		redisServiceMock.acquireLock.mockResolvedValueOnce(null)

		const call = service.startCheckout('acc-1', 'pro')

		await expect(call).rejects.toBeInstanceOf(ConflictException)
		await expect(call).rejects.toMatchObject({ response: { code: 'CHECKOUT_IN_PROGRESS' } })
		expect(stripeServiceMock.getOrCreateCustomer).not.toHaveBeenCalled()
		expect(redisServiceMock.releaseLock).not.toHaveBeenCalled()
	})

	it('409 SUBSCRIPTION_EXISTS from the local check, without calling Stripe', async () => {
		subscriptionServiceMock.hasBlockingSubscription.mockResolvedValueOnce(true)

		await expect(service.startCheckout('acc-1', 'pro')).rejects.toMatchObject({
			status: 409,
			response: { code: 'SUBSCRIPTION_EXISTS' },
		})
		expect(stripeServiceMock.getOrCreateCustomer).not.toHaveBeenCalled()
		expectLockReleased()
	})

	// The core of AUDIT-001: no local row yet (webhook not landed), but Stripe already
	// has a live subscription for this account.
	it.each([
		'active',
		'trialing',
		'past_due',
		'unpaid',
		'paused',
	])('409 SUBSCRIPTION_EXISTS when Stripe reports a live %s subscription (no session opened)', async (status) => {
		stripeServiceMock.listLiveSubscriptions.mockResolvedValueOnce([
			{ id: 'sub_x', status, created: nowSeconds(), metadata: { account_id: 'acc-1' } },
		])

		await expect(service.startCheckout('acc-1', 'pro')).rejects.toMatchObject({
			status: 409,
			response: { code: 'SUBSCRIPTION_EXISTS' },
		})
		expectNoSession()
		expect(stripeServiceMock.cancelSubscription).not.toHaveBeenCalled()
		expectLockReleased()
	})

	describe('incomplete (never-paid) attempts', () => {
		const incomplete = (ageMs: number, accountId = 'acc-1') => ({
			id: 'sub_inc',
			status: 'incomplete',
			created: Math.floor((Date.now() - ageMs) / 1000),
			metadata: { account_id: accountId },
		})

		it('cancels an old attempt of this account and proceeds', async () => {
			stripeServiceMock.listLiveSubscriptions.mockResolvedValueOnce([
				incomplete(INCOMPLETE_GRACE_MS + 60_000),
			])

			await expect(service.startCheckout('acc-1', 'pro')).resolves.toEqual({ url: 'https://pay' })

			expect(stripeServiceMock.cancelSubscription).toHaveBeenCalledWith('sub_inc')
		})

		it('a recent attempt may still be completing (3-D Secure): 409 wait, nothing canceled', async () => {
			stripeServiceMock.listLiveSubscriptions.mockResolvedValueOnce([incomplete(60_000)])

			await expect(service.startCheckout('acc-1', 'pro')).rejects.toMatchObject({
				response: { code: 'CHECKOUT_IN_PROGRESS' },
			})
			expect(stripeServiceMock.cancelSubscription).not.toHaveBeenCalled()
			expectNoSession()
		})

		it('never cancels an attempt that belongs to another account', async () => {
			stripeServiceMock.listLiveSubscriptions.mockResolvedValueOnce([
				incomplete(INCOMPLETE_GRACE_MS + 60_000, 'acc-other'),
			])

			await service.startCheckout('acc-1', 'pro')

			expect(stripeServiceMock.cancelSubscription).not.toHaveBeenCalled()
		})
	})

	// AUDIT-013: a slow Stripe call can outlive the lock; another attempt may then have
	// opened its own session, so ours is withdrawn.
	it('withdraws the new session and answers 409 when the lock expired mid-flight', async () => {
		redisServiceMock.isLockHeld.mockResolvedValueOnce(false)

		await expect(service.startCheckout('acc-1', 'pro')).rejects.toMatchObject({
			response: { code: 'CHECKOUT_IN_PROGRESS' },
		})

		expect(redisServiceMock.isLockHeld).toHaveBeenCalledWith('checkout-lock:acc-1', 'token-1')
		expect(stripeServiceMock.expireCheckoutSession).toHaveBeenCalledWith('cs_new')
	})

	it('fails closed (500, no session) when Stripe errors during the live check', async () => {
		stripeServiceMock.listLiveSubscriptions.mockRejectedValueOnce(new Error('api down'))

		const call = service.startCheckout('acc-1', 'pro')

		await expect(call).rejects.toBeInstanceOf(InternalServerErrorException)
		await expect(call).rejects.toThrow('Falha ao iniciar pagamento. Tente novamente.')
		expectNoSession()
		expectLockReleased()
	})

	it('fails closed when expiring older sessions errors', async () => {
		stripeServiceMock.expireOpenCheckoutSessions.mockRejectedValueOnce(new Error('api down'))

		await expect(service.startCheckout('acc-1', 'pro')).rejects.toBeInstanceOf(
			InternalServerErrorException,
		)
		expectNoSession()
	})

	it('500 when Stripe returns no session, lock still released', async () => {
		stripeServiceMock.createCheckoutSession.mockResolvedValueOnce(null)

		await expect(service.startCheckout('acc-1', 'pro')).rejects.toBeInstanceOf(
			InternalServerErrorException,
		)
		expectLockReleased()
	})

	it('a failed lock release never masks the result', async () => {
		redisServiceMock.releaseLock.mockRejectedValueOnce(new Error('redis blip'))

		await expect(service.startCheckout('acc-1', 'pro')).resolves.toEqual({ url: 'https://pay' })
	})

	it('400 when the price is not configured, before taking the lock', async () => {
		configServiceMock.get.mockImplementationOnce(() => undefined)

		await expect(service.startCheckout('acc-1', 'enterprise')).rejects.toThrow(
			'Plano inválido ou pagamento não configurado',
		)
		expect(redisServiceMock.acquireLock).not.toHaveBeenCalled()
	})
})
