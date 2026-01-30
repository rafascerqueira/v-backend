import { z } from "zod";

export const updateStoreStockSchema = z.object({
	quantity: z.coerce.number().int().optional(),
	reserved_quantity: z.coerce.number().int().optional(),
	min_stock: z.coerce.number().int().optional(),
	max_stock: z.coerce.number().int().optional(),
});

export type UpdateStoreStockDto = z.infer<typeof updateStoreStockSchema>;
