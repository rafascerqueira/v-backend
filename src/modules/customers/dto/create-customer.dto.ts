import { z } from 'zod'

const addressSchema = z.object({
	street: z.string().min(1),
	number: z.string().optional(),
	complement: z.string().optional(),
	neighborhood: z.string().optional(),
})

export const createCustomerSchema = z.object({
	name: z.string().min(1, 'Nome é obrigatório'),
	email: z.string().email('Email inválido'),
	phone: z.string().min(10, 'Telefone inválido'),
	document: z.string().min(11, 'Documento inválido'),
	address: addressSchema,
	city: z.string().min(1, 'Cidade é obrigatória'),
	state: z.string().length(2, 'Estado deve ter 2 caracteres'),
	zip_code: z.string().min(8, 'CEP inválido'),
})

export type CreateCustomerDto = z.infer<typeof createCustomerSchema>
