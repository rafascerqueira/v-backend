export interface UsageRecord {
	id: number
	account_id: string
	period_start: Date
	period_end: Date
	products_count: number
	orders_count: number
	customers_count: number
}

export interface SubscriptionRecord {
	id: number
	account_id: string
	plan_type: string
	status: string
	payment_provider: string | null
	provider_subscription_id: string | null
	provider_customer_id: string | null
	current_period_start: Date | null
	current_period_end: Date | null
	cancel_at_period_end: boolean
	canceled_at: Date | null
	trial_start: Date | null
	trial_end: Date | null
	createdAt: Date
}

export interface AccountEmailName {
	email: string
	name: string
}

export const SUBSCRIPTION_REPOSITORY = Symbol('SUBSCRIPTION_REPOSITORY')

export interface SubscriptionRepository {
	findAccountPlan(accountId: string): Promise<string | null>
	updateAccountPlan(accountId: string, planType: string): Promise<void>

	findActiveSubscription(accountId: string): Promise<SubscriptionRecord | null>
	createSubscription(data: {
		account_id: string
		plan_type: string
		status: string
		payment_provider: string
		provider_subscription_id: string
		provider_customer_id: string
		current_period_start: Date
		current_period_end: Date
		trial_start: Date | null
		trial_end: Date | null
	}): Promise<SubscriptionRecord>
	cancelSubscription(
		subscriptionId: number,
		cancelAtPeriodEnd: boolean,
	): Promise<SubscriptionRecord>

	findUsageRecord(accountId: string, periodStart: Date): Promise<UsageRecord | null>
	createUsageRecord(data: {
		account_id: string
		period_start: Date
		period_end: Date
		products_count: number
		orders_count: number
		customers_count: number
	}): Promise<UsageRecord>
	upsertUsageRecord(
		accountId: string,
		periodStart: Date,
		data: {
			period_end: Date
			products_count: number
			orders_count: number
			customers_count: number
		},
	): Promise<UsageRecord>

	countResources(
		accountId: string,
		periodStart: Date,
		periodEnd: Date,
	): Promise<{ products: number; orders: number; customers: number }>

	findAccountEmailName(accountId: string): Promise<AccountEmailName | null>

	createSubscriptionFromCheckout(data: {
		account_id: string
		payment_provider: string
		provider_subscription_id: string
		provider_customer_id: string
		status: string
		plan_type: string
		current_period_start: Date
		current_period_end: Date
	}): Promise<void>

	updateSubscriptionsByProviderId(
		providerSubscriptionId: string,
		data: Record<string, unknown>,
	): Promise<void>
}
