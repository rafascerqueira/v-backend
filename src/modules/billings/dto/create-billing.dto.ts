import { z } from 'zod'

// status / payment_status are intentionally absent: the server derives them from
// paid_amount vs total_amount (see deriveBillingStatus) so the stored state can't
// contradict the money. Any such fields sent by a client are stripped by Zod.
export const createBillingSchema = z.object({
	billing_number: z.string().min(1),
	total_amount: z.coerce.number().int().nonnegative().default(0),
	paid_amount: z.coerce.number().int().nonnegative().default(0),
	payment_method: z.enum(['cash', 'credit_card', 'debit_card', 'pix']).default('cash'),
	due_date: z.string().datetime().optional(),
	payment_date: z.string().datetime().optional(),
	notes: z.string().optional(),
})

export type CreateBillingDto = z.infer<typeof createBillingSchema>
