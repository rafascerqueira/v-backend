import { Inject, Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import Stripe from 'stripe'
import { SettingsService } from '@/modules/admin/services/settings.service'
import {
	SUBSCRIPTION_REPOSITORY,
	type SubscriptionRepository,
} from '@/shared/repositories/subscription.repository'

export interface ManagedStripeSubscription {
	accountId: string
	subscriptionId: string
	customerId: string
	status: Stripe.Subscription.Status
	planType: string
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
			apiVersion: '2026-02-25.clover',
		})

		this.logger.log('💳 Stripe initialized')
	}

	isConfigured(): boolean {
		return this.stripe !== null
	}

	async createCustomer(email: string, name: string, accountId: string): Promise<string | null> {
		if (!this.stripe) return null

		try {
			const customer = await this.stripe.customers.create({
				email,
				name,
				metadata: { account_id: accountId },
			})

			return customer.id
		} catch (error) {
			this.logger.error('Failed to create Stripe customer', error)
			return null
		}
	}

	async createCheckoutSession(
		accountId: string,
		priceId: string,
		successUrl: string,
		cancelUrl: string,
	): Promise<{ url: string | null; sessionId: string } | null> {
		if (!this.stripe) return null

		try {
			const account = await this.subscriptionRepository.findAccountEmailName(accountId)

			if (!account) return null

			const promo = await this.settingsService.getPromotionalPeriod()
			const couponId = promo.isActive
				? await this.ensurePromotionalCoupon(promo.discountPercent)
				: null

			const session = await this.stripe.checkout.sessions.create(
				{
					mode: 'subscription',
					payment_method_types: ['card'],
					line_items: [{ price: priceId, quantity: 1 }],
					success_url: successUrl,
					cancel_url: cancelUrl,
					customer_email: account.email,
					metadata: { account_id: accountId },
					subscription_data: {
						metadata: { account_id: accountId },
					},
					...(couponId ? { discounts: [{ coupon: couponId }] } : {}),
				},
				// Idempotency: a double-submit won't create two checkout sessions; a retry
				// within Stripe's 24h window replays the same (still-valid) session.
				{ idempotencyKey: `checkout_${accountId}_${priceId}` },
			)

			return { url: session.url, sessionId: session.id }
		} catch (error) {
			this.logger.error('Failed to create checkout session', error)
			return null
		}
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

	async cancelSubscription(subscriptionId: string): Promise<boolean> {
		if (!this.stripe) return false

		try {
			await this.stripe.subscriptions.cancel(subscriptionId)
			return true
		} catch (error) {
			this.logger.error('Failed to cancel subscription', error)
			return false
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
	 * from the subscription item (API 2026-02-25.clover), with a safe fallback so we never
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
					planType: sub.metadata?.plan_type || 'pro',
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
