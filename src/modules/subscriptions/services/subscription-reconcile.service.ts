import { Inject, Injectable, Logger } from '@nestjs/common'
import {
	SUBSCRIPTION_REPOSITORY,
	type SubscriptionRepository,
} from '@/shared/repositories/subscription.repository'
import { StripeService } from './stripe.service'

export interface ReconcileResult {
	configured: boolean
	stripeSubscriptions: number
	subscriptionsCreated: number
	subscriptionsUpdated: number
	accountsKeptPaid: number
	accountsDowngraded: number
}

const PAID_PLANS = ['pro', 'enterprise']

@Injectable()
export class SubscriptionReconcileService {
	private readonly logger = new Logger(SubscriptionReconcileService.name)

	constructor(
		private readonly stripeService: StripeService,
		@Inject(SUBSCRIPTION_REPOSITORY)
		private readonly subscriptionRepository: SubscriptionRepository,
	) {}

	/**
	 * Pulls the source of truth (Stripe) and reconciles local state both ways:
	 *  - upserts each managed subscription and ensures active/trialing accounts sit on
	 *    their paid plan (past_due keeps access during dunning, plan unchanged);
	 *  - downgrades any locally-paid account Stripe no longer reports as paid.
	 *
	 * Idempotent — safe to run on demand (admin) and on a schedule (cron). It's the
	 * safety net for any webhook that was missed or failed.
	 */
	async reconcile(): Promise<ReconcileResult> {
		if (!this.stripeService.isConfigured()) {
			this.logger.warn('Reconcile skipped — Stripe not configured')
			return {
				configured: false,
				stripeSubscriptions: 0,
				subscriptionsCreated: 0,
				subscriptionsUpdated: 0,
				accountsKeptPaid: 0,
				accountsDowngraded: 0,
			}
		}

		const subscriptions = await this.stripeService.listManagedSubscriptions()

		let created = 0
		let updated = 0
		const paidAccounts = new Set<string>()

		for (const sub of subscriptions) {
			const op = await this.subscriptionRepository.upsertSubscriptionFromStripe({
				account_id: sub.accountId,
				plan_type: sub.planType,
				status: sub.status,
				provider_subscription_id: sub.subscriptionId,
				provider_customer_id: sub.customerId,
				current_period_start: sub.periodStart,
				current_period_end: sub.periodEnd,
				cancel_at_period_end: sub.cancelAtPeriodEnd,
			})
			if (op === 'created') {
				created++
			} else {
				updated++
			}

			if (sub.status === 'active' || sub.status === 'trialing') {
				// Stripe says this account is paying → ensure the plan reflects it.
				await this.subscriptionRepository.updateAccountPlan(sub.accountId, sub.planType)
				paidAccounts.add(sub.accountId)
			} else if (sub.status === 'past_due') {
				// Keep access during dunning: don't change the plan, but don't downgrade either.
				paidAccounts.add(sub.accountId)
			}
		}

		// Reverse direction: a locally-paid account that Stripe no longer reports as paid
		// is stale (e.g. a missed subscription.deleted) → downgrade to free.
		const localPaid = await this.subscriptionRepository.findPaidAccountIds(PAID_PLANS)
		let downgraded = 0
		for (const accountId of localPaid) {
			if (!paidAccounts.has(accountId)) {
				await this.subscriptionRepository.updateAccountPlan(accountId, 'free')
				downgraded++
			}
		}

		const result: ReconcileResult = {
			configured: true,
			stripeSubscriptions: subscriptions.length,
			subscriptionsCreated: created,
			subscriptionsUpdated: updated,
			accountsKeptPaid: paidAccounts.size,
			accountsDowngraded: downgraded,
		}
		this.logger.log(`Reconcile done: ${JSON.stringify(result)}`)
		return result
	}
}
