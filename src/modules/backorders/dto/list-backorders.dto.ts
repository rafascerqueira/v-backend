import { z } from 'zod'

export const listBackordersSchema = z.object({
	product_id: z.coerce.number().int().positive().optional(),
	status: z.enum(['pending', 'fulfilled', 'canceled']).optional(),
})

export type ListBackordersDto = z.infer<typeof listBackordersSchema>
