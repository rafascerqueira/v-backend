import { z } from 'zod'

export const orderItemInputSchema = z.object({
	product_id: z.number().int().positive(),
	quantity: z.number().int().positive().default(1),
	unit_price: z.number().int().nonnegative(),
	discount: z.number().int().nonnegative().default(0),
})

export const createOrderSchema = z.object({
	customer_id: z.string().min(1),
	order_number: z.string().min(1),
	items: z.array(orderItemInputSchema).min(1),
	notes: z.string().optional(),
})

export type CreateOrderDto = z.infer<typeof createOrderSchema>
export type OrderItemInputDto = z.infer<typeof orderItemInputSchema>
