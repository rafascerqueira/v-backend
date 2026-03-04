import { Inject, Injectable } from '@nestjs/common'
import {
	SUBSCRIPTION_REPOSITORY,
	type SubscriptionRepository,
} from '@/shared/repositories/subscription.repository'
import { PLAN_LIMITS, type PlanFeatures, type PlanType } from '../constants/plan-limits'

@Injectable()
export class SubscriptionService {
	constructor(
		@Inject(SUBSCRIPTION_REPOSITORY)
		private readonly subscriptionRepository: SubscriptionRepository,
	) {}

	async getAccountPlan(accountId: string): Promise<PlanType> {
		const plan = await this.subscriptionRepository.findAccountPlan(accountId)
		return (plan as PlanType) || 'free'
	}

	async getActiveSubscription(accountId: string) {
		return this.subscriptionRepository.findActiveSubscription(accountId)
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

	async checkLimit(
		accountId: string,
		limitType: 'products' | 'orders' | 'customers',
	): Promise<{
		allowed: boolean
		current: number
		limit: number
		remaining: number
	}> {
		const plan = await this.getAccountPlan(accountId)
		const limits = PLAN_LIMITS[plan]
		const usage = await this.getCurrentUsage(accountId)

		let current: number
		let limit: number

		switch (limitType) {
			case 'products':
				current = usage.products_count
				limit = limits.maxProducts
				break
			case 'orders':
				current = usage.orders_count
				limit = limits.maxOrdersPerMonth
				break
			case 'customers':
				current = usage.customers_count
				limit = limits.maxCustomers
				break
		}

		// -1 means unlimited
		if (limit === -1) {
			return { allowed: true, current, limit: -1, remaining: -1 }
		}

		const remaining = Math.max(0, limit - current)
		const allowed = current < limit

		return { allowed, current, limit, remaining }
	}

	async hasFeature(accountId: string, feature: PlanFeatures): Promise<boolean> {
		const plan = await this.getAccountPlan(accountId)
		return PLAN_LIMITS[plan].features[feature]
	}

	async getSubscriptionInfo(accountId: string) {
		const [plan, subscription, usage] = await Promise.all([
			this.getAccountPlan(accountId),
			this.getActiveSubscription(accountId),
			this.getCurrentUsage(accountId),
		])

		const limits = PLAN_LIMITS[plan]

		return {
			plan,
			subscription,
			usage: {
				products: {
					current: usage.products_count,
					limit: limits.maxProducts,
					percentage:
						limits.maxProducts === -1
							? 0
							: Math.round((usage.products_count / limits.maxProducts) * 100),
				},
				orders: {
					current: usage.orders_count,
					limit: limits.maxOrdersPerMonth,
					percentage:
						limits.maxOrdersPerMonth === -1
							? 0
							: Math.round((usage.orders_count / limits.maxOrdersPerMonth) * 100),
				},
				customers: {
					current: usage.customers_count,
					limit: limits.maxCustomers,
					percentage:
						limits.maxCustomers === -1
							? 0
							: Math.round((usage.customers_count / limits.maxCustomers) * 100),
				},
			},
			features: limits.features,
			periodStart: usage.period_start,
			periodEnd: usage.period_end,
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
	}) {
		const subscription = await this.subscriptionRepository.createSubscription({
			account_id: data.accountId,
			plan_type: data.planType,
			status: data.trialEnd ? 'trialing' : 'active',
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

	async cancelSubscription(subscriptionId: number, cancelAtPeriodEnd = true) {
		return this.subscriptionRepository.cancelSubscription(subscriptionId, cancelAtPeriodEnd)
	}

	async handleSubscriptionEnded(accountId: string) {
		// Downgrade to free plan
		await this.updatePlan(accountId, 'free')
	}
}
