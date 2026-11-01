import { Inject, Injectable, Logger } from '@nestjs/common'
import {
	SUBSCRIPTION_REPOSITORY,
	type SubscriptionRepository,
} from '@/shared/repositories/subscription.repository'
import { isPayingStatus, PAID_PLANS } from '../constants/plan-limits'
import { type ManagedStripeSubscription, StripeService } from './stripe.service'

export interface ReconcileResult {
	configured: boolean
	stripeSubscriptions: number
	subscriptionsCreated: number
	subscriptionsUpdated: number
	accountsKeptPaid: number
	accountsDowngraded: number
	/** Subscriptions whose local upsert/plan update threw (logged, run continued). */
	failures: number
	/** Accounts with more than one live Stripe subscription (double billing, logged). */
	duplicateSubscriptionAccounts: number
}

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
				failures: 0,
				duplicateSubscriptionAccounts: 0,
			}
		}

		const subscriptions = await this.stripeService.listManagedSubscriptions()

		let created = 0
		let updated = 0
		let failures = 0
		const paidAccounts = new Set<string>()

		for (const sub of subscriptions) {
			// Decide "still paying" from Stripe's status BEFORE any write: if the local
			// upsert fails below, the account must still be protected from the downgrade pass.
			// past_due keeps access during dunning (plan unchanged, never downgraded).
			if (isPayingStatus(sub.status) || sub.status === 'past_due') {
				paidAccounts.add(sub.accountId)
			}

			// One bad row (unexpected data, transient DB error) must not abort the run for
			// every other account.
			try {
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

				if (isPayingStatus(sub.status)) {
					// Stripe says this account is paying → ensure the plan reflects it.
					await this.subscriptionRepository.updateAccountPlan(sub.accountId, sub.planType)
				}
			} catch (error) {
				failures++
				this.logger.error(
					`Reconcile failed for subscription ${sub.subscriptionId} (account ${sub.accountId})`,
					error instanceof Error ? error.stack : String(error),
				)
			}
		}

		// AUDIT-001 backstop: more than one live (active/trialing/past_due) subscription on
		// one account means it is being double-billed. Flag it for manual cancel/refund.
		const duplicateSubscriptionAccounts = this.flagDuplicateSubscriptions(subscriptions)

		// Reverse direction: a locally-paid account that Stripe no longer reports as paid
		// is stale (e.g. a missed subscription.deleted) → downgrade to free.
		const localPaid = await this.subscriptionRepository.findPaidAccountIds([...PAID_PLANS])
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
			failures,
			duplicateSubscriptionAccounts,
		}
		this.logger.log(`Reconcile done: ${JSON.stringify(result)}`)
		return result
	}

	/** Logs every account with more than one live subscription; returns how many. */
	private flagDuplicateSubscriptions(subscriptions: ManagedStripeSubscription[]): number {
		const byAccount = new Map<string, string[]>()
		for (const sub of subscriptions) {
			const ids = byAccount.get(sub.accountId) ?? []
			ids.push(sub.subscriptionId)
			byAccount.set(sub.accountId, ids)
		}

		let duplicates = 0
		for (const [accountId, ids] of byAccount) {
			if (ids.length > 1) {
				duplicates++
				this.logger.error(
					`[DUPLICATE_SUBSCRIPTION] account ${accountId} has ${ids.length} live Stripe subscriptions: ${ids.join(', ')}`,
				)
			}
		}
		return duplicates
	}
}
