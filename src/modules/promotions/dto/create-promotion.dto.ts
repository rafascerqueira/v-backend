import { z } from 'zod'

export const createPromotionSchema = z.object({
	product_id: z.coerce.number().int().positive(),
	discount_percent: z.number().int().min(1).max(99),
	start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'start_date must be YYYY-MM-DD'),
	end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'end_date must be YYYY-MM-DD'),
	description: z.string().optional(),
})

export type CreatePromotionDto = z.infer<typeof createPromotionSchema>
