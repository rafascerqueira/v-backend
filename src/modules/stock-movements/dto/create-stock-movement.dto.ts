import { z } from 'zod'

export const movementTypeEnum = z.enum(['in', 'out'])
export const referenceTypeEnum = z.enum(['purchase', 'sale', 'adjustment', 'return', 'transfer'])

export const createStockMovementSchema = z.object({
	movement_type: movementTypeEnum,
	reference_type: referenceTypeEnum,
	reference_id: z.number().int().nonnegative(),
	product_id: z.number().int().positive(),
	quantity: z.number().int().positive(),
})

export type CreateStockMovementDto = z.infer<typeof createStockMovementSchema>
