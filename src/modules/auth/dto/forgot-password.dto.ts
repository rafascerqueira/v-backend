import { z } from 'zod'

export const forgotPasswordSchema = z.object({
	email: z.string().email('Email inválido'),
})

export type ForgotPasswordDto = z.infer<typeof forgotPasswordSchema>

export const resetPasswordSchema = z.object({
	token: z.string().min(1, 'Token é obrigatório'),
	password: z.string().min(6, 'Senha deve ter pelo menos 6 caracteres'),
})

export type ResetPasswordDto = z.infer<typeof resetPasswordSchema>
