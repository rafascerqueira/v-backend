import { z } from 'zod'

export const authCustomerSchema = z.object({
	contact: z.string().min(5, 'Informe email ou telefone'),
	password: z.string().min(6, 'Senha deve ter pelo menos 6 caracteres'),
})

export type AuthCustomerDto = z.infer<typeof authCustomerSchema>
