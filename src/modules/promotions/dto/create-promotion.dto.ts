import { z } from 'zod'

export const createPromotionSchema = z.object({
	product_id: z.coerce.number().int().positive(),
	discount_percent: z.number().int().min(1).max(99),
	start_date: z.string().min(1),
	end_date: z.string().min(1),
	description: z.string().optional(),
})

export type CreatePromotionDto = z.infer<typeof createPromotionSchema>
