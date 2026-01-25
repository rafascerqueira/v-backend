import { z } from 'zod'

export const createProductPriceSchema = z.object({
  price: z.number().int().nonnegative(),
  price_type: z.enum(['cost', 'sale', 'wholesale', 'promotional']).default('sale'),
  valid_from: z.string().datetime().optional(),
  valid_to: z.string().datetime().optional(),
  active: z.boolean().optional().default(true),
})

export type CreateProductPriceDto = z.infer<typeof createProductPriceSchema>
