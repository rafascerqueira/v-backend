import { Inject, Injectable, Logger } from '@nestjs/common'
import Stripe from 'stripe'
import {
	WEBHOOK_REPOSITORY,
	type WebhookRepository,
} from '@/shared/repositories/webhook.repository'
import {
	isPayingStatus,
	type PaidPlanType,
	type PlanType,
	toPaidPlanType,
} from '../constants/plan-limits'
import { StripeService } from './stripe.service'
import { SubscriptionService } from './subscription.service'

type InternalSubscriptionStatus = 'active' | 'canceled' | 'past_due' | 'trialing' | 'paused'

const STRIPE_STATUS_MAP: Record<Stripe.Subscription.Status, InternalSubscriptionStatus> = {
	active: 'active',
	trialing: 'trialing',
	past_due: 'past_due',
	canceled: 'canceled',
	unpaid: 'past_due',
	paused: 'paused',
	incomplete: 'past_due',
	incomplete_expired: 'canceled',
}

/** Stripe lifecycle status → our SubscriptionStatus enum. */
export function mapStripeStatus(status: string): InternalSubscriptionStatus {
	return STRIPE_STATUS_MAP[status as Stripe.Subscription.Status] ?? 'active'
}

function fromUnixSeconds(seconds: number | null | undefined): Date | null {
	return seconds ? new Date(seconds * 1000) : null
}

interface PagSeguroWebhookEvent {
	id: string
	type: string
	data: {
		id: string
		reference_id: string
		status: string
		plan?: { id: string }
		next_invoice_at?: string
	}
}

@Injectable()
export class WebhookService {
	private readonly logger = new Logger(WebhookService.name)

	constructor(
		@Inject(WEBHOOK_REPOSITORY) private readonly webhookRepository: WebhookRepository,
		private readonly subscriptionService: SubscriptionService,
		private readonly stripeService: StripeService,
	) {}

	async processStripeWebhook(event: Stripe.Event) {
		const existing = await this.webhookRepository.findWebhookEvent(event.id)

		if (existing?.processed) {
			this.logger.log(`Webhook ${event.id} already processed, skipping`)
			return { success: true, message: 'Already processed' }
		}

		const webhookRecord = await this.webhookRepository.upsertWebhookEvent({
			event_id: event.id,
			provider: 'stripe',
			event_type: event.type,
			payload: event as unknown as Record<string, unknown>,
		})

		try {
			await this.handleStripeEvent(event)
			await this.webhookRepository.markWebhookProcessed(webhookRecord.id)
			return { success: true }
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : 'Unknown error'
			await this.webhookRepository.markWebhookError(webhookRecord.id, errorMessage)
			throw error
		}
	}

	private async handleStripeEvent(event: Stripe.Event) {
		switch (event.type) {
			case 'checkout.session.completed':
				await this.handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session)
				break

			case 'customer.subscription.created':
			case 'customer.subscription.updated':
				await this.handleSubscriptionUpdate(event.data.object as Stripe.Subscription)
				break

			case 'customer.subscription.deleted':
				await this.handleSubscriptionDeleted(event.data.object as Stripe.Subscription)
				break

			case 'invoice.payment_succeeded':
				await this.handleInvoicePaymentSucceeded(event.data.object as Stripe.Invoice)
				break

			case 'invoice.payment_failed':
				await this.handleInvoicePaymentFailed(event.data.object as Stripe.Invoice)
				break

			default:
				this.logger.log(`Unhandled Stripe event type: ${event.type}`)
		}
	}

	private async handleCheckoutCompleted(session: Stripe.Checkout.Session) {
		const accountId = session.metadata?.account_id
		if (!accountId) {
			this.logger.warn('checkout.session.completed: no account_id in metadata')
			return
		}

		// An async/unpaid completion (e.g. a future boleto/Pix flow) must not grant anything;
		// the subscription events will grant it once it's actually paid.
		if (session.payment_status === 'unpaid') {
			this.logger.log(
				`checkout.session.completed unpaid for account ${accountId}; plan not granted`,
			)
			return
		}

		// Upgrade eagerly (customer.subscription.created may lag), but from the LIVE
		// subscription: a retried event for a subscription canceled meanwhile must not
		// re-grant the plan. This also records the row (same upsert path, idempotent).
		const subscriptionId =
			typeof session.subscription === 'string' ? session.subscription : session.subscription?.id
		const live = subscriptionId
			? await this.stripeService.retrieveSubscription(subscriptionId)
			: null
		if (live) {
			await this.applySubscriptionState(live)
			return
		}

		// Stripe not configured / no subscription on the session: fall back to the tier
		// validated from metadata (set server-side at checkout).
		const planType = this.planFromMetadata(session.metadata?.plan_type)
		await this.subscriptionService.updatePlan(accountId, planType)
		this.logger.log(`✅ Plan upgraded on checkout completion for account ${accountId}`)
	}

	private async handleSubscriptionUpdate(eventSubscription: Stripe.Subscription) {
		// Re-read the live state instead of trusting the payload: Stripe doesn't guarantee
		// event ordering, so a delayed `created` (incomplete) must not overwrite a newer
		// `active`. Falls back to the payload only when Stripe isn't configured.
		const subscription =
			(await this.stripeService.retrieveSubscription(eventSubscription.id)) ?? eventSubscription
		await this.applySubscriptionState(subscription)
	}

	/**
	 * Persists a subscription's (live) state and grants the plan only for a paying status.
	 * Every subscription-affecting event funnels through here.
	 */
	private async applySubscriptionState(subscription: Stripe.Subscription) {
		const accountId = subscription.metadata?.account_id
		if (!accountId) {
			this.logger.warn('No account_id in subscription metadata')
			return
		}

		const planType = this.stripeService.resolvePlanType({
			priceId: subscription.items?.data?.[0]?.price?.id,
			metadataPlanType: subscription.metadata?.plan_type,
		})
		const period = this.getSubscriptionPeriod(subscription)

		await this.subscriptionService.syncStripeSubscription({
			account_id: accountId,
			plan_type: planType,
			status: mapStripeStatus(subscription.status),
			provider_subscription_id: subscription.id,
			provider_customer_id:
				typeof subscription.customer === 'string'
					? subscription.customer
					: subscription.customer.id,
			current_period_start: period?.start ?? null,
			current_period_end: period?.end ?? null,
			cancel_at_period_end: subscription.cancel_at_period_end,
			trial_start: fromUnixSeconds(subscription.trial_start),
			trial_end: fromUnixSeconds(subscription.trial_end),
		})

		// Only a paying subscription grants the plan; past_due keeps whatever the account
		// already had (dunning grace) and never upgrades an account that never paid.
		if (isPayingStatus(subscription.status)) {
			await this.subscriptionService.updatePlan(accountId, planType)
		}
	}

	/**
	 * Metadata is client-influenced and frozen at checkout; never let an unknown value
	 * reach the PlanType enum (Prisma would throw and Stripe would retry for days).
	 */
	private planFromMetadata(value: unknown): PaidPlanType {
		const plan = toPaidPlanType(value)
		if (!plan) {
			this.logger.warn(`Unknown plan_type in Stripe metadata (${String(value)}), using 'pro'`)
			return 'pro'
		}
		return plan
	}

	private async handleSubscriptionDeleted(subscription: Stripe.Subscription) {
		const accountId = subscription.metadata?.account_id
		if (!accountId) return

		await this.webhookRepository.updateSubscriptionsByProviderId(subscription.id, {
			status: 'canceled',
			canceled_at: new Date(),
		})

		// Don't downgrade if the account still has another paying subscription (e.g. an
		// abandoned/expired first attempt ending after a successful re-subscribe).
		const stillPaying = await this.subscriptionService.getActiveSubscription(accountId)
		if (stillPaying) {
			this.logger.log(
				`Subscription ${subscription.id} ended but account ${accountId} still has an active one; plan kept`,
			)
			return
		}

		await this.subscriptionService.handleSubscriptionEnded(accountId)
	}

	// Invoice events re-sync from the live subscription instead of writing a status from
	// the invoice: a late/retried payment_succeeded must not resurrect a canceled row as
	// 'active' (which would also wrongly block a new checkout with 409).
	private async handleInvoicePaymentSucceeded(invoice: Stripe.Invoice) {
		const subscriptionId = this.getInvoiceSubscriptionId(invoice)
		if (!subscriptionId) return

		const live = await this.stripeService.retrieveSubscription(subscriptionId)
		if (live) {
			await this.applySubscriptionState(live)
			return
		}

		// Stripe not configured: best effort from the invoice payload.
		await this.webhookRepository.updateSubscriptionsByProviderId(subscriptionId, {
			status: 'active',
			current_period_start: new Date(invoice.period_start * 1000),
			current_period_end: new Date(invoice.period_end * 1000),
		})
	}

	private async handleInvoicePaymentFailed(invoice: Stripe.Invoice) {
		const subscriptionId = this.getInvoiceSubscriptionId(invoice)
		if (!subscriptionId) return

		const live = await this.stripeService.retrieveSubscription(subscriptionId)
		if (live) {
			await this.applySubscriptionState(live)
			return
		}

		await this.webhookRepository.updateSubscriptionsByProviderId(subscriptionId, {
			status: 'past_due',
		})
	}

	/**
	 * Stripe moved the billing period from the top of the Subscription object onto
	 * each subscription item (API 2025-04+, incl. the pinned 2026-03-25.dahlia). Read
	 * it from items.data[0] and convert UNIX seconds → Date. Returns null when
	 * unavailable so callers never persist an Invalid Date.
	 */
	private getSubscriptionPeriod(
		subscription: Stripe.Subscription,
	): { start: Date; end: Date } | null {
		const item = subscription.items?.data?.[0]
		if (!item?.current_period_start || !item?.current_period_end) return null
		return {
			start: new Date(item.current_period_start * 1000),
			end: new Date(item.current_period_end * 1000),
		}
	}

	/**
	 * Stripe moved the invoice→subscription link under parent.subscription_details
	 * (API 2025-04+, incl. dahlia); the top-level invoice.subscription no longer exists.
	 */
	private getInvoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
		const ref = invoice.parent?.subscription_details?.subscription
		if (!ref) return null
		return typeof ref === 'string' ? ref : ref.id
	}

	async processPagSeguroWebhook(event: PagSeguroWebhookEvent) {
		const existing = await this.webhookRepository.findWebhookEvent(event.id)

		if (existing?.processed) {
			return { success: true, message: 'Already processed' }
		}

		const webhookRecord = await this.webhookRepository.upsertWebhookEvent({
			event_id: event.id,
			provider: 'pagseguro',
			event_type: event.type,
			payload: event as unknown as Record<string, unknown>,
		})

		try {
			await this.handlePagSeguroEvent(event)
			await this.webhookRepository.markWebhookProcessed(webhookRecord.id)
			return { success: true }
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : 'Unknown error'
			await this.webhookRepository.markWebhookError(webhookRecord.id, errorMessage)
			throw error
		}
	}

	private async handlePagSeguroEvent(event: PagSeguroWebhookEvent) {
		switch (event.type) {
			case 'SUBSCRIPTION.ACTIVATED':
			case 'SUBSCRIPTION.RENEWED':
				await this.handlePagSeguroSubscriptionActive(event.data)
				break

			case 'SUBSCRIPTION.CANCELED':
			case 'SUBSCRIPTION.EXPIRED':
				await this.handlePagSeguroSubscriptionEnded(event.data)
				break

			case 'SUBSCRIPTION.PAYMENT_FAILED':
				await this.handlePagSeguroPaymentFailed(event.data)
				break

			default:
				this.logger.log(`Unhandled PagSeguro event type: ${event.type}`)
		}
	}

	private async handlePagSeguroSubscriptionActive(data: PagSeguroWebhookEvent['data']) {
		const accountId = data.reference_id
		if (!accountId) return

		const subscription = await this.webhookRepository.findSubscriptionByProviderId(data.id)

		if (subscription) {
			await this.webhookRepository.updateSubscriptionById(subscription.id, {
				status: 'active',
				...(data.next_invoice_at && { current_period_end: new Date(data.next_invoice_at) }),
			})
			await this.subscriptionService.updatePlan(accountId, subscription.plan_type as PlanType)
		}
	}

	private async handlePagSeguroSubscriptionEnded(data: PagSeguroWebhookEvent['data']) {
		const accountId = data.reference_id
		if (!accountId) return

		await this.webhookRepository.updateSubscriptionsByProviderId(data.id, {
			status: 'canceled',
			canceled_at: new Date(),
		})

		await this.subscriptionService.handleSubscriptionEnded(accountId)
	}

	private async handlePagSeguroPaymentFailed(data: PagSeguroWebhookEvent['data']) {
		await this.webhookRepository.updateSubscriptionsByProviderId(data.id, {
			status: 'past_due',
		})
	}
}
