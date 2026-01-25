import { z } from 'zod'

export const updateStoreStockSchema = z.object({
  quantity: z.number().int().optional(),
  reserved_quantity: z.number().int().optional(),
  min_stock: z.number().int().optional(),
  max_stock: z.number().int().optional(),
})

export type UpdateStoreStockDto = z.infer<typeof updateStoreStockSchema>
