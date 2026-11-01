export const PLAN_LIMITS = {
	free: {
		maxProducts: 50,
		maxOrdersPerMonth: 30,
		maxCustomers: 100,
		features: {
			reports: false,
			exportData: false,
			multipleImages: false,
			prioritySupport: false,
			customBranding: false,
			apiAccess: false,
		},
	},
	pro: {
		maxProducts: 500,
		maxOrdersPerMonth: 500,
		maxCustomers: 1000,
		features: {
			reports: true,
			exportData: true,
			multipleImages: true,
			prioritySupport: false,
			customBranding: false,
			apiAccess: false,
		},
	},
	enterprise: {
		maxProducts: -1, // unlimited
		maxOrdersPerMonth: -1,
		maxCustomers: -1,
		features: {
			reports: true,
			exportData: true,
			multipleImages: true,
			prioritySupport: true,
			customBranding: true,
			apiAccess: true,
		},
	},
} as const

export type PlanType = keyof typeof PLAN_LIMITS
export type PlanFeatures = keyof (typeof PLAN_LIMITS)['free']['features']

/** Tiers that are sold through Stripe. */
export const PAID_PLANS = ['pro', 'enterprise'] as const
export type PaidPlanType = (typeof PAID_PLANS)[number]

/**
 * Narrows an untrusted value (Stripe metadata, a request body) to a paid tier, or
 * null. Anything that reaches the Prisma `PlanType` enum from outside must go
 * through this first: an unknown string there throws and blocks the whole webhook.
 */
export function toPaidPlanType(value: unknown): PaidPlanType | null {
	return typeof value === 'string' && (PAID_PLANS as readonly string[]).includes(value)
		? (value as PaidPlanType)
		: null
}

/**
 * Subscription statuses that grant the paid plan. past_due keeps a plan the account
 * already has (dunning grace) but never grants one.
 */
export function isPayingStatus(status: string): boolean {
	return status === 'active' || status === 'trialing'
}

export const PLAN_PRICES = {
	free: 0,
	pro: 1490, // R$ 14,90 em centavos (early adopter; futuro R$ 19,90)
	enterprise: 14990, // R$ 149,90 em centavos
} as const

export const PLAN_NAMES = {
	free: 'Gratuito',
	pro: 'Profissional',
	enterprise: 'Empresarial',
} as const
