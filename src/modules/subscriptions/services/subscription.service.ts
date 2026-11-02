import { Inject, Injectable } from '@nestjs/common'
import { SettingsService } from '@/modules/admin/services/settings.service'
import {
	type StripeSubscriptionUpsert,
	SUBSCRIPTION_REPOSITORY,
	type SubscriptionRepository,
} from '@/shared/repositories/subscription.repository'
import { isPayingStatus, PLAN_LIMITS, type PlanType } from '../constants/plan-limits'
import { PlanLimitsService } from './plan-limits.service'

@Injectable()
export class SubscriptionService {
	constructor(
		@Inject(SUBSCRIPTION_REPOSITORY)
		private readonly subscriptionRepository: SubscriptionRepository,
		private readonly settingsService: SettingsService,
		private readonly planLimitsService: PlanLimitsService,
	) {}

	async getAccountPlan(accountId: string): Promise<PlanType> {
		const plan = await this.subscriptionRepository.findAccountPlan(accountId)
		return (plan as PlanType) || 'free'
	}

	async getActiveSubscription(accountId: string) {
		return this.subscriptionRepository.findActiveSubscription(accountId)
	}

	/**
	 * The subscription a seller can still manage in the billing portal — active,
	 * trialing, past_due or paused. Unlike getActiveSubscription this keeps past_due,
	 * so a seller whose renewal failed can update their card instead of being told
	 * "no active subscription" and silently churning at period end.
	 */
	async getManageableSubscription(accountId: string) {
		return this.subscriptionRepository.findManageableSubscription(accountId)
	}

	async getCurrentUsage(accountId: string) {
		const now = new Date()
		const periodStart = new Date(now.getFullYear(), now.getMonth(), 1)
		const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59)

		let usageRecord = await this.subscriptionRepository.findUsageRecord(accountId, periodStart)

		if (!usageRecord) {
			const counts = await this.subscriptionRepository.countResources(
				accountId,
				periodStart,
				periodEnd,
			)

			usageRecord = await this.subscriptionRepository.createUsageRecord({
				account_id: accountId,
				period_start: periodStart,
				period_end: periodEnd,
				products_count: counts.products,
				orders_count: counts.orders,
				customers_count: counts.customers,
			})
		}

		return usageRecord
	}

	async refreshUsage(accountId: string) {
		const now = new Date()
		const periodStart = new Date(now.getFullYear(), now.getMonth(), 1)
		const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59)

		const counts = await this.subscriptionRepository.countResources(
			accountId,
			periodStart,
			periodEnd,
		)

		return this.subscriptionRepository.upsertUsageRecord(accountId, periodStart, {
			period_end: periodEnd,
			products_count: counts.products,
			orders_count: counts.orders,
			customers_count: counts.customers,
		})
	}

	async getSubscriptionInfo(accountId: string) {
		const [plan, subscription, usage, unlimitedWindow] = await Promise.all([
			this.getAccountPlan(accountId),
			// Manageable, not active-only: the UI must see a past_due subscription to warn
			// the seller that the renewal failed (the dunning banner/bell notice).
			this.getManageableSubscription(accountId),
			this.getCurrentUsage(accountId),
			this.settingsService.getUnlimitedPeriodWindow(),
		])

		const limits = PLAN_LIMITS[plan]
		const unlimitedActiveForFree = plan === 'free' && unlimitedWindow.isActive

		// Features must reflect the EFFECTIVE plan (promo window / admin grant), the same
		// resolution the FeatureGuard uses — otherwise the UI would lock a feature the API
		// actually allows (or vice-versa).
		const features = await this.planLimitsService.getEffectiveFeatures(accountId, plan)

		const effectiveLimits = unlimitedActiveForFree
			? { products: -1, orders: -1, customers: -1 }
			: {
					products: limits.maxProducts,
					orders: limits.maxOrdersPerMonth,
					customers: limits.maxCustomers,
				}

		return {
			plan,
			subscription,
			usage: {
				products: {
					current: usage.products_count,
					limit: effectiveLimits.products,
					percentage:
						effectiveLimits.products === -1
							? 0
							: Math.round((usage.products_count / effectiveLimits.products) * 100),
				},
				orders: {
					current: usage.orders_count,
					limit: effectiveLimits.orders,
					percentage:
						effectiveLimits.orders === -1
							? 0
							: Math.round((usage.orders_count / effectiveLimits.orders) * 100),
				},
				customers: {
					current: usage.customers_count,
					limit: effectiveLimits.customers,
					percentage:
						effectiveLimits.customers === -1
							? 0
							: Math.round((usage.customers_count / effectiveLimits.customers) * 100),
				},
			},
			features,
			periodStart: usage.period_start,
			periodEnd: usage.period_end,
			activeWindow: unlimitedActiveForFree
				? {
						type: 'unlimited_period' as const,
						startDate: unlimitedWindow.startDate,
						endDate: unlimitedWindow.endDate,
					}
				: null,
		}
	}

	async updatePlan(accountId: string, newPlan: PlanType) {
		await this.subscriptionRepository.updateAccountPlan(accountId, newPlan)
	}

	/**
	 * Persists a Stripe subscription's state (create-or-update on the unique provider id).
	 * Deliberately does NOT touch the account plan: the caller grants it only for a paying
	 * status (see isPayingStatus), so a row recorded as past_due/canceled never upgrades.
	 */
	async syncStripeSubscription(data: StripeSubscriptionUpsert) {
		return this.subscriptionRepository.upsertSubscriptionFromStripe(data)
	}

	/**
	 * Whether the account must be refused a new checkout (409): it already has a
	 * manageable subscription AND is actually paying or on a paid plan. A free account
	 * whose only row is a never-paid attempt (incomplete → stored as past_due) may retry
	 * checkout; otherwise it would be stuck, with no "manage" action available to it.
	 */
	async hasBlockingSubscription(accountId: string): Promise<boolean> {
		const [plan, subscription] = await Promise.all([
			this.getAccountPlan(accountId),
			this.getManageableSubscription(accountId),
		])
		if (!subscription) return false
		return isPayingStatus(subscription.status) || plan !== 'free'
	}

	async handleSubscriptionEnded(accountId: string) {
		// Downgrade to free plan
		await this.updatePlan(accountId, 'free')
	}
}
