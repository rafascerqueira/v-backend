import { createHash } from 'node:crypto'
import {
	Inject,
	Injectable,
	InternalServerErrorException,
	Logger,
	NotFoundException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import Stripe from 'stripe'
import { SettingsService } from '@/modules/admin/services/settings.service'
import {
	SUBSCRIPTION_REPOSITORY,
	type SubscriptionRepository,
} from '@/shared/repositories/subscription.repository'
import { PAID_PLANS, type PaidPlanType, toPaidPlanType } from '../constants/plan-limits'

/**
 * Checkout session lifetime. Stripe's minimum is 30 minutes; a margin above it keeps
 * clock skew / request latency from tripping the minimum-expiry validation.
 */
const CHECKOUT_SESSION_TTL_SECONDS = 35 * 60

/**
 * Bounded Stripe calls (SDK defaults: 80s timeout, 2 retries). Checkout runs several
 * calls under a per-account lock, so a single slow call must not outlive the lock;
 * webhooks and the reconcile are retried by Stripe/cron anyway.
 */
const STRIPE_TIMEOUT_MS = 20_000
const STRIPE_MAX_NETWORK_RETRIES = 1

/** Terminal subscription statuses: anything else is still alive in Stripe. */
const ENDED_SUBSCRIPTION_STATUSES: ReadonlySet<Stripe.Subscription.Status> = new Set([
	'canceled',
	'incomplete_expired',
])

function hashParams(params: unknown): string {
	return createHash('sha256').update(JSON.stringify(params)).digest('hex').slice(0, 16)
}

export interface ManagedStripeSubscription {
	accountId: string
	subscriptionId: string
	customerId: string
	status: Stripe.Subscription.Status
	planType: PaidPlanType
	periodStart: Date
	periodEnd: Date
	cancelAtPeriodEnd: boolean
}

@Injectable()
export class StripeService {
	private readonly logger = new Logger(StripeService.name)
	private stripe: Stripe | null = null
	private readonly webhookSecret: string | undefined

	constructor(
		@Inject(SUBSCRIPTION_REPOSITORY)
		private readonly subscriptionRepository: SubscriptionRepository,
		private readonly configService: ConfigService,
		private readonly settingsService: SettingsService,
	) {
		this.webhookSecret = configService.get<string>('stripe.webhookSecret')
		this.initializeStripe()
	}

	private initializeStripe() {
		const secretKey = this.configService.get<string>('stripe.secretKey')

		if (!secretKey) {
			this.logger.warn('💳 Stripe not configured - payments disabled')
			return
		}

		this.stripe = new Stripe(secretKey, {
			apiVersion: '2026-03-25.dahlia',
			timeout: STRIPE_TIMEOUT_MS,
			maxNetworkRetries: STRIPE_MAX_NETWORK_RETRIES,
		})

		this.logger.log('💳 Stripe initialized')
	}

	isConfigured(): boolean {
		return this.stripe !== null
	}

	private requireStripe(): Stripe {
		if (!this.stripe) {
			throw new InternalServerErrorException('Pagamento não configurado')
		}
		return this.stripe
	}

	/**
	 * The account's single Stripe Customer, created on first use and stored on the
	 * account. Reusing it is what lets Stripe (and our live check) see an existing
	 * subscription. Throws on Stripe/DB errors: checkout must fail closed.
	 */
	async getOrCreateCustomer(accountId: string): Promise<string> {
		const stripe = this.requireStripe()

		const existing = await this.subscriptionRepository.findStripeCustomerId(accountId)
		if (existing) {
			if (await this.customerIsUsable(stripe, existing)) return existing

			// The stored Customer was deleted in Stripe (support cleanup, data erasure) or
			// belongs to the other Stripe mode. Without replacing it, every checkout and
			// portal call would fail forever. The replacement uses a DIFFERENT idempotency
			// key: the original one would replay the deleted Customer for 24h.
			this.logger.warn(
				`Stripe Customer ${existing} of account ${accountId} is gone; creating a replacement`,
			)
			const replacement = await this.createCustomer(stripe, accountId, `replace_${existing}`)
			const stored = await this.subscriptionRepository.replaceStripeCustomerId(
				accountId,
				existing,
				replacement,
			)
			return stored ?? replacement
		}

		const customerId = await this.createCustomer(stripe, accountId, 'initial')
		// A concurrent request may have stored its Customer first; converge on that one.
		const stored = await this.subscriptionRepository.setStripeCustomerIdIfMissing(
			accountId,
			customerId,
		)
		return stored ?? customerId
	}

	private async customerIsUsable(stripe: Stripe, customerId: string): Promise<boolean> {
		try {
			const customer = await stripe.customers.retrieve(customerId)
			return !(customer as Stripe.DeletedCustomer).deleted
		} catch (error) {
			if ((error as Stripe.errors.StripeError)?.code === 'resource_missing') return false
			throw error
		}
	}

	private async createCustomer(
		stripe: Stripe,
		accountId: string,
		purpose: string,
	): Promise<string> {
		const account = await this.subscriptionRepository.findAccountEmailName(accountId)
		if (!account) throw new NotFoundException('Conta não encontrada')

		const params: Stripe.CustomerCreateParams = {
			email: account.email,
			name: account.name,
			metadata: { account_id: accountId },
		}
		// Keyed by account + purpose + params: a retry after a failed DB write replays the
		// same Customer instead of creating an orphan.
		const customer = await stripe.customers.create(params, {
			idempotencyKey: `customer_${accountId}_${purpose}_${hashParams(params)}`,
		})
		return customer.id
	}

	/**
	 * Every subscription of these Customers that is still alive in Stripe (anything not
	 * canceled/incomplete_expired), read live so it doesn't depend on webhooks having
	 * landed. A Customer deleted in Stripe is skipped.
	 */
	async listLiveSubscriptions(customerIds: string[]): Promise<Stripe.Subscription[]> {
		const stripe = this.requireStripe()
		const live: Stripe.Subscription[] = []

		for (const customer of new Set(customerIds)) {
			try {
				for await (const sub of stripe.subscriptions.list({
					customer,
					status: 'all',
					limit: 100,
				})) {
					if (!ENDED_SUBSCRIPTION_STATUSES.has(sub.status)) live.push(sub)
				}
			} catch (error) {
				if ((error as Stripe.errors.StripeError)?.code === 'resource_missing') continue
				throw error
			}
		}

		return live
	}

	async cancelSubscription(subscriptionId: string): Promise<void> {
		await this.requireStripe().subscriptions.cancel(subscriptionId)
	}

	/** Expires every still-open Checkout session of the Customer; returns how many. */
	async expireOpenCheckoutSessions(customerId: string): Promise<number> {
		const stripe = this.requireStripe()
		let expired = 0
		for await (const session of stripe.checkout.sessions.list({
			customer: customerId,
			status: 'open',
			limit: 100,
		})) {
			await stripe.checkout.sessions.expire(session.id)
			expired++
		}
		return expired
	}

	/** Expires one session (used when a checkout attempt lost its lock mid-flight). */
	async expireCheckoutSession(sessionId: string): Promise<void> {
		await this.requireStripe().checkout.sessions.expire(sessionId)
	}

	/**
	 * `attemptId` scopes the idempotency key to ONE checkout attempt (the lock token), so
	 * it only dedupes the SDK's own network retries of this request. Stripe compares the
	 * whole request body for a reused key, and `expires_at` changes every second, so a
	 * key shared across attempts would make every retry fail with idempotency_error.
	 * Cross-attempt duplicates are prevented by the per-account lock and by expiring
	 * older open sessions (CheckoutService).
	 */
	async createCheckoutSession(
		accountId: string,
		customerId: string,
		priceId: string,
		successUrl: string,
		cancelUrl: string,
		planType: string,
		attemptId: string,
	): Promise<{ url: string | null; sessionId: string } | null> {
		if (!this.stripe) return null

		try {
			const promo = await this.settingsService.getPromotionalPeriod()
			const couponId = promo.isActive
				? await this.ensurePromotionalCoupon(promo.discountPercent)
				: null

			// account_id rides on BOTH the session and subscription_data metadata: later
			// customer.subscription.* events only carry the subscription's own metadata.
			// plan_type travels the same way so the webhook activates the plan the buyer
			// actually paid for instead of assuming 'pro' (matters once a 2nd paid tier ships).
			const metadata = { account_id: accountId, plan_type: planType }

			const params: Stripe.Checkout.SessionCreateParams = {
				mode: 'subscription',
				payment_method_types: ['card'],
				line_items: [{ price: priceId, quantity: 1 }],
				success_url: successUrl,
				cancel_url: cancelUrl,
				// The account's own Customer (never customer_email, which made Stripe create
				// a new Customer per session and hid existing subscriptions).
				customer: customerId,
				metadata,
				subscription_data: { metadata },
				// Short-lived: an abandoned tab can't be paid hours later next to a newer
				// session (Stripe's minimum is 30 minutes).
				expires_at: Math.floor(Date.now() / 1000) + CHECKOUT_SESSION_TTL_SECONDS,
				...(couponId ? { discounts: [{ coupon: couponId }] } : {}),
			}

			const session = await this.stripe.checkout.sessions.create(params, {
				idempotencyKey: `checkout_${accountId}_${attemptId}`,
			})

			return { url: session.url, sessionId: session.id }
		} catch (error) {
			this.logger.error('Failed to create checkout session', error)
			return null
		}
	}

	/**
	 * The paid tier a subscription grants, resolved from what Stripe actually bills (the
	 * item's price), not from metadata frozen at checkout: a Billing Portal plan switch
	 * changes the price but never the metadata. Falls back to the validated metadata tier
	 * for prices not mapped in config, then to 'pro'.
	 */
	resolvePlanType(input: { priceId?: string | null; metadataPlanType?: unknown }): PaidPlanType {
		if (input.priceId) {
			for (const plan of PAID_PLANS) {
				if (this.configService.get<string>(`stripe.priceIds.${plan}`) === input.priceId) {
					return plan
				}
			}
		}
		const fromMetadata = toPaidPlanType(input.metadataPlanType)
		if (fromMetadata) return fromMetadata
		this.logger.warn(
			`Could not resolve plan for price ${input.priceId ?? '(none)'} / metadata ${String(input.metadataPlanType)}; using 'pro'`,
		)
		return 'pro'
	}

	/**
	 * Current state of a subscription straight from Stripe. Webhook handlers use it
	 * instead of the event payload so a delayed or out-of-order event can never roll the
	 * stored state back. Returns null when Stripe isn't configured; API errors propagate
	 * so the webhook is marked failed and Stripe retries it.
	 */
	async retrieveSubscription(subscriptionId: string): Promise<Stripe.Subscription | null> {
		if (!this.stripe) return null
		return this.stripe.subscriptions.retrieve(subscriptionId)
	}

	private async ensurePromotionalCoupon(discountPercent: number): Promise<string | null> {
		if (!this.stripe) return null
		const couponId = `promo_${Math.round(discountPercent)}_off`

		try {
			await this.stripe.coupons.retrieve(couponId)
			return couponId
		} catch (err) {
			const stripeErr = err as Stripe.errors.StripeError
			if (stripeErr?.code !== 'resource_missing') {
				this.logger.error('Failed to retrieve coupon', err)
				return null
			}
		}

		try {
			await this.stripe.coupons.create({
				id: couponId,
				percent_off: discountPercent,
				duration: 'once',
				name: `${discountPercent}% off (promotional period)`,
			})
			return couponId
		} catch (err) {
			this.logger.error('Failed to create promotional coupon', err)
			return null
		}
	}

	async createPortalSession(customerId: string, returnUrl: string): Promise<string | null> {
		if (!this.stripe) return null

		try {
			const session = await this.stripe.billingPortal.sessions.create({
				customer: customerId,
				return_url: returnUrl,
			})

			return session.url
		} catch (error) {
			this.logger.error('Failed to create portal session', error)
			return null
		}
	}

	async getSubscription(subscriptionId: string): Promise<Stripe.Subscription | null> {
		if (!this.stripe) return null

		try {
			return await this.stripe.subscriptions.retrieve(subscriptionId)
		} catch (error) {
			this.logger.error('Failed to get subscription', error)
			return null
		}
	}

	/**
	 * Lists the subscriptions we manage (active / trialing / past_due) for reconciliation,
	 * normalized to the fields our system stores. Auto-paginates. Subscriptions without an
	 * `account_id` in metadata are skipped — we never guess the tenant. Period fields come
	 * from the subscription item (API 2026-03-25.dahlia), with a safe fallback so we never
	 * produce an Invalid Date.
	 */
	async listManagedSubscriptions(): Promise<ManagedStripeSubscription[]> {
		if (!this.stripe) return []

		const statuses = ['active', 'trialing', 'past_due'] as const
		const result: ManagedStripeSubscription[] = []

		for (const status of statuses) {
			for await (const sub of this.stripe.subscriptions.list({ status, limit: 100 })) {
				const accountId = sub.metadata?.account_id
				if (!accountId) continue

				const item = sub.items?.data?.[0]
				result.push({
					accountId,
					subscriptionId: sub.id,
					customerId: typeof sub.customer === 'string' ? sub.customer : sub.customer.id,
					status: sub.status,
					// Tier from the billed price (survives portal plan switches); dirty
					// metadata can never reach the PlanType enum and abort the reconcile.
					planType: this.resolvePlanType({
						priceId: item?.price?.id,
						metadataPlanType: sub.metadata?.plan_type,
					}),
					periodStart: item?.current_period_start
						? new Date(item.current_period_start * 1000)
						: new Date(),
					periodEnd: item?.current_period_end
						? new Date(item.current_period_end * 1000)
						: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
					cancelAtPeriodEnd: sub.cancel_at_period_end,
				})
			}
		}

		return result
	}

	constructWebhookEvent(payload: Buffer, signature: string): Stripe.Event | null {
		if (!this.stripe) return null

		const webhookSecret = this.webhookSecret
		if (!webhookSecret) {
			this.logger.error('Stripe webhook secret not configured')
			return null
		}

		try {
			return this.stripe.webhooks.constructEvent(payload, signature, webhookSecret)
		} catch (error) {
			this.logger.error('Failed to construct webhook event', error)
			return null
		}
	}
}
