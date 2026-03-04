import { Inject, Injectable, Logger } from '@nestjs/common'
import {
	WEBHOOK_REPOSITORY,
	type WebhookRepository,
} from '@/shared/repositories/webhook.repository'
import type { PlanType } from '../constants/plan-limits'
import { SubscriptionService } from './subscription.service'

interface StripeWebhookEvent {
	id: string
	type: string
	data: {
		object: {
			id: string
			customer: string
			status: string
			current_period_start: number
			current_period_end: number
			cancel_at_period_end: boolean
			metadata?: { plan_type?: string; account_id?: string }
		}
	}
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
	) {}

	async processStripeWebhook(event: StripeWebhookEvent) {
		// Check if already processed (idempotency)
		const existing = await this.webhookRepository.findWebhookEvent(event.id)

		if (existing?.processed) {
			this.logger.log(`Webhook ${event.id} already processed, skipping`)
			return { success: true, message: 'Already processed' }
		}

		// Store webhook event
		const webhookRecord = await this.webhookRepository.upsertWebhookEvent({
			event_id: event.id,
			provider: 'stripe',
			event_type: event.type,
			payload: event,
		})

		try {
			await this.handleStripeEvent(event)

			// Mark as processed
			await this.webhookRepository.markWebhookProcessed(webhookRecord.id)

			return { success: true }
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : 'Unknown error'
			await this.webhookRepository.markWebhookError(webhookRecord.id, errorMessage)
			throw error
		}
	}

	private async handleStripeEvent(event: StripeWebhookEvent) {
		const { type, data } = event

		switch (type) {
			case 'customer.subscription.created':
			case 'customer.subscription.updated':
				await this.handleStripeSubscriptionUpdate(data.object)
				break

			case 'customer.subscription.deleted':
				await this.handleStripeSubscriptionDeleted(data.object)
				break

			case 'invoice.payment_succeeded':
				this.logger.log(`Payment succeeded for subscription`)
				break

			case 'invoice.payment_failed':
				await this.handleStripePaymentFailed(data.object)
				break

			default:
				this.logger.log(`Unhandled Stripe event type: ${type}`)
		}
	}

	private async handleStripeSubscriptionUpdate(subscription: StripeWebhookEvent['data']['object']) {
		const accountId = subscription.metadata?.account_id
		if (!accountId) {
			this.logger.warn('No account_id in subscription metadata')
			return
		}

		const planType = (subscription.metadata?.plan_type || 'pro') as PlanType

		// Find or create subscription record
		const existingSub = await this.webhookRepository.findSubscriptionByProviderId(subscription.id)

		const statusMap: Record<string, 'active' | 'canceled' | 'past_due' | 'trialing' | 'paused'> = {
			active: 'active',
			trialing: 'trialing',
			past_due: 'past_due',
			canceled: 'canceled',
			unpaid: 'past_due',
			paused: 'paused',
		}

		if (existingSub) {
			await this.webhookRepository.updateSubscriptionById(existingSub.id, {
				status: statusMap[subscription.status] || 'active',
				current_period_start: new Date(subscription.current_period_start * 1000),
				current_period_end: new Date(subscription.current_period_end * 1000),
				cancel_at_period_end: subscription.cancel_at_period_end,
			})
		} else {
			await this.subscriptionService.createSubscription({
				accountId,
				planType,
				paymentProvider: 'stripe',
				providerSubscriptionId: subscription.id,
				providerCustomerId: subscription.customer,
				periodStart: new Date(subscription.current_period_start * 1000),
				periodEnd: new Date(subscription.current_period_end * 1000),
			})
		}

		// Update account plan if subscription is active
		if (subscription.status === 'active' || subscription.status === 'trialing') {
			await this.subscriptionService.updatePlan(accountId, planType)
		}
	}

	private async handleStripeSubscriptionDeleted(
		subscription: StripeWebhookEvent['data']['object'],
	) {
		const accountId = subscription.metadata?.account_id
		if (!accountId) return

		await this.webhookRepository.updateSubscriptionsByProviderId(subscription.id, {
			status: 'canceled',
			canceled_at: new Date(),
		})

		// Downgrade to free
		await this.subscriptionService.handleSubscriptionEnded(accountId)
	}

	private async handleStripePaymentFailed(data: any) {
		const subscriptionId = data.subscription
		if (!subscriptionId) return

		await this.webhookRepository.updateSubscriptionsByProviderId(subscriptionId, {
			status: 'past_due',
		})
	}

	async processPagSeguroWebhook(event: PagSeguroWebhookEvent) {
		// Check if already processed
		const existing = await this.webhookRepository.findWebhookEvent(event.id)

		if (existing?.processed) {
			return { success: true, message: 'Already processed' }
		}

		const webhookRecord = await this.webhookRepository.upsertWebhookEvent({
			event_id: event.id,
			provider: 'pagseguro',
			event_type: event.type,
			payload: event,
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
		const { type, data } = event

		switch (type) {
			case 'SUBSCRIPTION.ACTIVATED':
			case 'SUBSCRIPTION.RENEWED':
				await this.handlePagSeguroSubscriptionActive(data)
				break

			case 'SUBSCRIPTION.CANCELED':
			case 'SUBSCRIPTION.EXPIRED':
				await this.handlePagSeguroSubscriptionEnded(data)
				break

			case 'SUBSCRIPTION.PAYMENT_FAILED':
				await this.handlePagSeguroPaymentFailed(data)
				break

			default:
				this.logger.log(`Unhandled PagSeguro event type: ${type}`)
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
