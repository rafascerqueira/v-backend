import { z } from 'zod'

export const orderItemInputSchema = z.object({
	product_id: z.coerce.number().int().positive(),
	quantity: z.coerce.number().int().positive().default(1),
	unit_price: z.coerce.number().int().nonnegative(),
	discount: z.coerce.number().int().nonnegative().default(0),
})

export const createOrderSchema = z.object({
	customer_id: z.string().min(1),
	/** @deprecated Ignored: the server numbers orders (PED-000123). Accepted for old clients. */
	order_number: z.string().optional(),
	items: z.array(orderItemInputSchema).min(1),
	notes: z.string().optional(),
})

export type CreateOrderDto = z.infer<typeof createOrderSchema>
export type OrderItemInputDto = z.infer<typeof orderItemInputSchema>
