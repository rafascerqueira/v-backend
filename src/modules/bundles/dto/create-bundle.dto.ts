import { z } from 'zod'

export const bundleItemSchema = z.object({
	product_id: z.number().int().positive(),
	quantity: z.number().int().positive().default(1),
})

export const createBundleSchema = z.object({
	name: z.string().min(1).max(100),
	description: z.string().optional(),
	discount_percent: z.number().int().min(0).max(100).default(0),
	active: z.boolean().default(true),
	items: z.array(bundleItemSchema).min(1),
})

export type CreateBundleDto = z.infer<typeof createBundleSchema>
