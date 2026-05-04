import { z } from 'zod'

const isoDate = z.string().refine((v) => !Number.isNaN(Date.parse(v)), { message: 'invalid date' })

const dateRange = {
	effectiveFrom: isoDate,
	effectiveUntil: isoDate.nullable(),
}

const planSchema = z.enum(['free', 'pro', 'enterprise'])
const grantedPlanSchema = z.enum(['pro', 'enterprise'])

const unlimitedWindowSchema = z.object({
	type: z.literal('unlimited_window'),
	...dateRange,
	reason: z.string().min(3),
	metadata: z.object({}).optional().default({}),
})

const customLimitsSchema = z.object({
	type: z.literal('custom_limits'),
	...dateRange,
	reason: z.string().min(3),
	metadata: z
		.object({
			maxProducts: z.number().int().min(0).optional(),
			maxCustomers: z.number().int().min(0).optional(),
			maxOrdersPerMonth: z.number().int().min(0).optional(),
		})
		.refine(
			(m) =>
				m.maxProducts !== undefined ||
				m.maxCustomers !== undefined ||
				m.maxOrdersPerMonth !== undefined,
			{ message: 'at least one limit override must be provided' },
		),
})

const billingAdjustmentSchema = z.object({
	type: z.literal('billing_adjustment'),
	...dateRange,
	reason: z.string().min(3),
	metadata: z.object({
		nextBillingDate: isoDate,
		previousNextBillingDate: isoDate,
	}),
})

const planGrantSchema = z.object({
	type: z.literal('plan_grant'),
	...dateRange,
	reason: z.string().min(3),
	metadata: z.object({
		grantedPlan: grantedPlanSchema,
		previousPlan: planSchema,
	}),
})

export const createAccountExceptionSchema = z.discriminatedUnion('type', [
	unlimitedWindowSchema,
	customLimitsSchema,
	billingAdjustmentSchema,
	planGrantSchema,
])

export type CreateAccountExceptionInput = z.infer<typeof createAccountExceptionSchema>

export const revokeAccountExceptionSchema = z.object({
	reason: z.string().min(3),
})

export type RevokeAccountExceptionInput = z.infer<typeof revokeAccountExceptionSchema>

export const listAccountExceptionsSchema = z.object({
	type: z
		.enum(['unlimited_window', 'custom_limits', 'billing_adjustment', 'plan_grant'])
		.optional(),
	status: z.enum(['active', 'expired', 'revoked']).optional(),
	account_id: z.string().optional(),
	page: z.coerce.number().int().min(1).default(1),
	limit: z.coerce.number().int().min(1).max(100).default(20),
})

export type ListAccountExceptionsInput = z.infer<typeof listAccountExceptionsSchema>
