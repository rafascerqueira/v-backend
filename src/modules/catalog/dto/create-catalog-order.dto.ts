import { z } from 'zod'

export const catalogCustomerSchema = z.object({
	name: z.string().min(3, 'Nome deve ter pelo menos 3 caracteres'),
	phone: z.string().min(10, 'Telefone inválido'),
	email: z.email('Email inválido').optional(),
	document: z.string().optional(),
	address: z.string().optional(),
	number: z.string().optional(),
	complement: z.string().optional(),
	neighborhood: z.string().optional(),
	city: z.string().optional(),
	state: z.string().optional(),
	zip_code: z.string().optional(),
})

export const catalogOrderItemSchema = z.object({
	product_id: z.coerce.number().int().positive(),
	quantity: z.coerce.number().int().positive().default(1),
})

export const createCatalogOrderSchema = z
	.object({
		customerId: z.string().optional(),
		customer: catalogCustomerSchema.optional(),
		items: z.array(catalogOrderItemSchema).min(1, 'Adicione pelo menos um item'),
		notes: z.string().optional(),
	})
	.refine((d) => d.customerId !== undefined || d.customer !== undefined, {
		message: 'Forneça customerId ou os dados do cliente',
	})

export type CatalogCustomerDto = z.infer<typeof catalogCustomerSchema>
export type CatalogOrderItemDto = z.infer<typeof catalogOrderItemSchema>
export type CreateCatalogOrderDto = z.infer<typeof createCatalogOrderSchema>
