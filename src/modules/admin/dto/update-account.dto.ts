import { z } from 'zod'

export const updateAccountSchema = z
	.object({
		name: z.string().min(1).max(100).optional(),
		email: z.email().max(100).optional(),
		role: z.enum(['seller', 'admin']).optional(),
		plan_type: z.enum(['free', 'pro', 'enterprise']).optional(),
		is_active: z.boolean().optional(),
	})
	.refine((data) => Object.values(data).some((v) => v !== undefined), {
		message: 'Informe ao menos um campo para atualizar',
	})

export type UpdateAccountDto = z.infer<typeof updateAccountSchema>
