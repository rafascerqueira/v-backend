import { z } from 'zod'

// status / payment_status are intentionally absent: the server re-derives them from
// the resulting paid_amount vs total_amount (see deriveBillingStatus). Any such
// fields sent by a client are stripped by Zod. `canceled` is owned by order
// cancellation and preserved by the service, not set through this endpoint.
export const updateBillingSchema = z.object({
	total_amount: z.coerce.number().int().nonnegative().optional(),
	paid_amount: z.coerce.number().int().nonnegative().optional(),
	payment_method: z.enum(['cash', 'credit_card', 'debit_card', 'pix']).optional(),
	due_date: z.string().datetime().optional().nullable(),
	payment_date: z.string().datetime().optional().nullable(),
	notes: z.string().optional(),
})

export type UpdateBillingDto = z.infer<typeof updateBillingSchema>
