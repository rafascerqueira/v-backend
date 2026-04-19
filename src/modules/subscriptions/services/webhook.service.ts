import { Inject, Injectable, Logger } from '@nestjs/common'
import Stripe from 'stripe'
import {
	WEBHOOK_REPOSITORY,
	type WebhookRepository,
} from '@/shared/repositories/webhook.repository'
import type { PlanType } from '../constants/plan-limits'
import { SubscriptionService } from './subscription.service'

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
		// customer.subscription.created fires right after and creates the full record;
		// here we just ensure the account plan is upgraded immediately on checkout completion.
		await this.subscriptionService.updatePlan(accountId, 'pro')
		this.logger.log(`✅ Plan upgraded on checkout completion for account ${accountId}`)
	}

	private async handleSubscriptionUpdate(subscription: Stripe.Subscription) {
		const accountId = subscription.metadata?.account_id
		if (!accountId) {
			this.logger.warn('No account_id in subscription metadata')
			return
		}

		const planType = (subscription.metadata?.plan_type || 'pro') as PlanType

		const statusMap: Record<string, 'active' | 'canceled' | 'past_due' | 'trialing' | 'paused'> = {
			active: 'active',
			trialing: 'trialing',
			past_due: 'past_due',
			canceled: 'canceled',
			unpaid: 'past_due',
			paused: 'paused',
		}

		const existingSub = await this.webhookRepository.findSubscriptionByProviderId(subscription.id)

		const sub = subscription as any
		if (existingSub) {
			await this.webhookRepository.updateSubscriptionById(existingSub.id, {
				status: statusMap[subscription.status] || 'active',
				current_period_start: new Date(sub.current_period_start * 1000),
				current_period_end: new Date(sub.current_period_end * 1000),
				cancel_at_period_end: subscription.cancel_at_period_end,
			})
		} else {
			await this.subscriptionService.createSubscription({
				accountId,
				planType,
				paymentProvider: 'stripe',
				providerSubscriptionId: subscription.id,
				providerCustomerId: subscription.customer as string,
				periodStart: new Date(sub.current_period_start * 1000),
				periodEnd: new Date(sub.current_period_end * 1000),
			})
		}

		if (subscription.status === 'active' || subscription.status === 'trialing') {
			await this.subscriptionService.updatePlan(accountId, planType)
		}
	}

	private async handleSubscriptionDeleted(subscription: Stripe.Subscription) {
		const accountId = subscription.metadata?.account_id
		if (!accountId) return

		await this.webhookRepository.updateSubscriptionsByProviderId(subscription.id, {
			status: 'canceled',
			canceled_at: new Date(),
		})

		await this.subscriptionService.handleSubscriptionEnded(accountId)
	}

	private async handleInvoicePaymentSucceeded(invoice: Stripe.Invoice) {
		const subscriptionId = (invoice as any).subscription as string | null
		if (!subscriptionId) return

		await this.webhookRepository.updateSubscriptionsByProviderId(subscriptionId, {
			status: 'active',
			current_period_start: new Date((invoice as any).period_start * 1000),
			current_period_end: new Date((invoice as any).period_end * 1000),
		})
	}

	private async handleInvoicePaymentFailed(invoice: Stripe.Invoice) {
		const subscriptionId = (invoice as any).subscription as string | null
		if (!subscriptionId) return

		await this.webhookRepository.updateSubscriptionsByProviderId(subscriptionId, {
			status: 'past_due',
		})
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
