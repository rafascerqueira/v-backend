import { z } from 'zod'

const emptyToNull = (val: string | undefined) => (val === '' || val === undefined ? null : val)

const addressSchema = z
	.object({
		street: z.string().optional(),
		number: z.string().optional(),
		complement: z.string().optional(),
		neighborhood: z.string().optional(),
	})
	.optional()

export const createCustomerSchema = z.object({
	name: z.string().min(1, 'Nome é obrigatório'),
	email: z.string().email('Email inválido').optional().or(z.literal('')).transform(emptyToNull),
	phone: z.string().min(10, 'Telefone inválido'),
	document: z
		.string()
		.min(11, 'Documento inválido')
		.optional()
		.or(z.literal(''))
		.transform(emptyToNull),
	address: addressSchema.default({}),
	city: z.string().min(1, 'Cidade é obrigatória'),
	state: z.string().length(2, 'Estado deve ter 2 caracteres'),
	zip_code: z.string().min(8, 'CEP inválido').optional().or(z.literal('')).transform(emptyToNull),
})

export type CreateCustomerDto = z.infer<typeof createCustomerSchema>
