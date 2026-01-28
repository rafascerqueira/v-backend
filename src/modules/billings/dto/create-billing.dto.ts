import { z } from 'zod'

export const createBillingSchema = z.object({
	billing_number: z.string().min(1),
	total_amount: z.number().int().nonnegative().default(0),
	paid_amount: z.number().int().nonnegative().default(0),
	payment_method: z.enum(['cash', 'credit_card', 'debit_card', 'pix']).default('cash'),
	payment_status: z.enum(['pending', 'confirmed', 'canceled']).default('pending'),
	status: z.enum(['pending', 'partial', 'paid', 'overdue', 'canceled']).default('pending'),
	due_date: z.string().datetime().optional(),
	payment_date: z.string().datetime().optional(),
	notes: z.string().optional(),
})

export type CreateBillingDto = z.infer<typeof createBillingSchema>
