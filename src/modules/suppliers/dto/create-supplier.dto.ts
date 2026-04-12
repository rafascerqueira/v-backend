import { z } from 'zod'

export const createSupplierSchema = z.object({
	name: z.string().min(2).max(100),
	email: z.string().email().optional().or(z.literal('')),
	phone: z.string().max(20).optional(),
	address: z.string().max(255).optional(),
	notes: z.string().optional(),
})

export type CreateSupplierDto = z.infer<typeof createSupplierSchema>
