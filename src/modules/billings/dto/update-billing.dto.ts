import { z } from "zod";

export const updateBillingSchema = z.object({
	total_amount: z.coerce.number().int().nonnegative().optional(),
	paid_amount: z.coerce.number().int().nonnegative().optional(),
	payment_method: z
		.enum(["cash", "credit_card", "debit_card", "pix"])
		.optional(),
	payment_status: z.enum(["pending", "confirmed", "canceled"]).optional(),
	status: z
		.enum(["pending", "partial", "paid", "overdue", "canceled"])
		.optional(),
	due_date: z.string().datetime().optional().nullable(),
	payment_date: z.string().datetime().optional().nullable(),
	notes: z.string().optional(),
});

export type UpdateBillingDto = z.infer<typeof updateBillingSchema>;
