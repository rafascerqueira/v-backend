import { z } from 'zod'

export const createAccountSchema = z.object({
	name: z.string().min(1, 'Nome é obrigatório').max(100),
	email: z.string().email('Email inválido'),
	password: z
		.string()
		.min(6, 'Senha deve ter no mínimo 6 caracteres')
		.max(100, 'Senha muito longa')
		.regex(
			/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
			'Senha deve conter letras maiúsculas, minúsculas e números',
		),
})

export type CreateAccountDto = z.infer<typeof createAccountSchema>
