import { z } from "zod";

export const updateProductPriceSchema = z.object({
	price: z.coerce.number().int().nonnegative().optional(),
	price_type: z.enum(["cost", "sale", "wholesale", "promotional"]).optional(),
	valid_from: z.string().datetime().optional().nullable(),
	valid_to: z.string().datetime().optional().nullable(),
	active: z.boolean().optional(),
});

export type UpdateProductPriceDto = z.infer<typeof updateProductPriceSchema>;
