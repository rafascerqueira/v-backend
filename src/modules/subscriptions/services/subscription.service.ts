import { Inject, Injectable } from '@nestjs/common'
import { SettingsService } from '@/modules/admin/services/settings.service'
import {
	SUBSCRIPTION_REPOSITORY,
	type SubscriptionRepository,
} from '@/shared/repositories/subscription.repository'
import { PLAN_LIMITS, type PlanType } from '../constants/plan-limits'
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
			this.getActiveSubscription(accountId),
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

	async createSubscription(data: {
		accountId: string
		planType: PlanType
		paymentProvider: string
		providerSubscriptionId: string
		providerCustomerId: string
		periodStart: Date
		periodEnd: Date
		trialEnd?: Date
		// Explicit lifecycle status from the provider; falls back to trial-vs-active
		// inference when the caller doesn't know it.
		status?: string
	}) {
		const subscription = await this.subscriptionRepository.createSubscription({
			account_id: data.accountId,
			plan_type: data.planType,
			status: data.status ?? (data.trialEnd ? 'trialing' : 'active'),
			payment_provider: data.paymentProvider,
			provider_subscription_id: data.providerSubscriptionId,
			provider_customer_id: data.providerCustomerId,
			current_period_start: data.periodStart,
			current_period_end: data.periodEnd,
			trial_start: data.trialEnd ? new Date() : null,
			trial_end: data.trialEnd ?? null,
		})

		// Update account plan
		await this.updatePlan(data.accountId, data.planType)

		return subscription
	}

	async handleSubscriptionEnded(accountId: string) {
		// Downgrade to free plan
		await this.updatePlan(accountId, 'free')
	}
}
