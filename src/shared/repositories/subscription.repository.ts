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

export interface StripeSubscriptionUpsert {
	account_id: string
	plan_type: string
	status: string
	provider_subscription_id: string
	provider_customer_id: string | null
	/** null = Stripe didn't send it: keep the stored value (a fallback is used only on create). */
	current_period_start: Date | null
	current_period_end: Date | null
	cancel_at_period_end: boolean
	/** undefined = leave untouched; null = clear. */
	trial_start?: Date | null
	trial_end?: Date | null
}

export const SUBSCRIPTION_REPOSITORY = Symbol('SUBSCRIPTION_REPOSITORY')

export interface SubscriptionRepository {
	findAccountPlan(accountId: string): Promise<string | null>
	updateAccountPlan(accountId: string, planType: string): Promise<void>

	findActiveSubscription(accountId: string): Promise<SubscriptionRecord | null>
	// Latest subscription a seller can still manage in the billing portal: active,
	// trialing, past_due or paused (past_due included so dunning sellers can fix a card).
	findManageableSubscription(accountId: string): Promise<SubscriptionRecord | null>

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

	updateSubscriptionsByProviderId(
		providerSubscriptionId: string,
		data: Record<string, unknown>,
	): Promise<void>

	// The single write path for Stripe subscription state (webhook + reconcile):
	// create-or-update keyed by the unique provider_subscription_id. Race-safe: a
	// concurrent create that loses on the unique index is applied as an update.
	upsertSubscriptionFromStripe(data: StripeSubscriptionUpsert): Promise<'created' | 'updated'>

	// Reconciliation: account ids currently sitting on a paid plan, used to detect
	// accounts that should be downgraded because Stripe no longer has them active.
	findPaidAccountIds(planTypes: string[]): Promise<string[]>

	// --- One Stripe Customer per account (AUDIT-001) ---
	findStripeCustomerId(accountId: string): Promise<string | null>
	// Stores the Customer only if the account has none yet; returns whichever id ends up
	// stored (ours, or the one a concurrent request saved first).
	setStripeCustomerIdIfMissing(accountId: string, customerId: string): Promise<string | null>
	// Swaps a stale (deleted in Stripe) Customer for its replacement, only if the account
	// still points at the stale one; returns whichever id ends up stored.
	replaceStripeCustomerId(
		accountId: string,
		staleCustomerId: string,
		customerId: string,
	): Promise<string | null>
	// Distinct Stripe Customers already seen on the account's subscription rows (legacy
	// accounts may have several, from before Customers were reused).
	findProviderCustomerIds(accountId: string): Promise<string[]>
	// provider_subscription_id of the account's active/trialing Stripe rows.
	findPayingProviderSubscriptionIds(accountId: string): Promise<string[]>
}
