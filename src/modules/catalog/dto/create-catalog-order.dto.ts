import { z } from 'zod'

export const catalogCustomerSchema = z.object({
	name: z.string().min(3, 'Nome deve ter pelo menos 3 caracteres'),
	email: z.string().email('Email inválido'),
	phone: z.string().min(10, 'Telefone inválido'),
	document: z.string().min(11, 'CPF/CNPJ inválido'),
	address: z.string().min(3, 'Endereço é obrigatório'),
	number: z.string().min(1, 'Número é obrigatório'),
	complement: z.string().optional(),
	neighborhood: z.string().min(2, 'Bairro é obrigatório'),
	city: z.string().min(2, 'Cidade é obrigatória'),
	state: z.string().length(2, 'Estado deve ter 2 caracteres'),
	zip_code: z.string().min(8, 'CEP inválido'),
})

export const catalogOrderItemSchema = z.object({
	product_id: z.number().int().positive(),
	quantity: z.number().int().positive().default(1),
})

export const createCatalogOrderSchema = z.object({
	customer: catalogCustomerSchema,
	items: z.array(catalogOrderItemSchema).min(1, 'Adicione pelo menos um item'),
	notes: z.string().optional(),
})

export type CatalogCustomerDto = z.infer<typeof catalogCustomerSchema>
export type CatalogOrderItemDto = z.infer<typeof catalogOrderItemSchema>
export type CreateCatalogOrderDto = z.infer<typeof createCatalogOrderSchema>
