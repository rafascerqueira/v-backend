import { z } from 'zod'

export const createDebtSchema = z.object({
	amount: z.number().int().positive(),
	description: z.string().min(2).max(255),
	due_date: z.string().optional(),
})

export type CreateDebtDto = z.infer<typeof createDebtSchema>

export const payDebtSchema = z.object({
	amount: z.number().int().positive(),
})

export type PayDebtDto = z.infer<typeof payDebtSchema>
