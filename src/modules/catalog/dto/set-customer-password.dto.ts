import { z } from 'zod'

export const requestCustomerOtpSchema = z.object({
	contact: z.string().min(5, 'Informe email ou telefone'),
})

export type RequestCustomerOtpDto = z.infer<typeof requestCustomerOtpSchema>

export const setCustomerPasswordSchema = z.object({
	contact: z.string().min(5, 'Informe email ou telefone'),
	// One-time code sent to the customer's registered email — proves they control the mailbox.
	otp: z.string().regex(/^\d{6}$/, 'Código inválido'),
	password: z.string().min(8, 'Senha deve ter pelo menos 8 caracteres'),
})

export type SetCustomerPasswordDto = z.infer<typeof setCustomerPasswordSchema>

export const redeemInviteSchema = z.object({
	// One-time token issued by the seller (covers customers without an email on file).
	token: z.string().min(1, 'Convite inválido'),
	password: z.string().min(8, 'Senha deve ter pelo menos 8 caracteres'),
})

export type RedeemInviteDto = z.infer<typeof redeemInviteSchema>
