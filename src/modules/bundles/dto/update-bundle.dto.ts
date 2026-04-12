import { z } from 'zod'
import { bundleItemSchema } from './create-bundle.dto'

export const updateBundleSchema = z.object({
	name: z.string().min(1).max(100).optional(),
	description: z.string().optional(),
	discount_percent: z.number().int().min(0).max(100).optional(),
	active: z.boolean().optional(),
	items: z.array(bundleItemSchema).min(1).optional(),
})

export type UpdateBundleDto = z.infer<typeof updateBundleSchema>
