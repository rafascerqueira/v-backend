import { z } from 'zod'

export const loginSchema = z.object({
	email: z.string().email('Email inválido'),
	password: z.string().min(6, 'Senha deve ter no mínimo 6 caracteres'),
	twoFactorToken: z.string().length(6).optional(),
	// "Manter conectado". On by default: the session survives closing the browser.
	remember: z.boolean().optional().default(true),
})

export type LoginDto = z.infer<typeof loginSchema>
