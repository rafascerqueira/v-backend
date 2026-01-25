import { z } from 'zod'

export const createProductSchema = z.object({
	name: z.string().min(1, 'Nome é obrigatório').max(100),
	description: z.string().min(1, 'Descrição é obrigatória'),
	sku: z.string().min(1, 'SKU é obrigatório').max(50),
	category: z.string().min(1, 'Categoria é obrigatória').max(100),
	brand: z.string().min(1, 'Marca é obrigatória').max(100),
	unit: z.string().max(20).default('un'),
	specifications: z.object({
		imported: z.boolean(),
		moreinfo: z.string().optional(),
	}),
	images: z.array(z.string().url('URL de imagem inválida')).default([]),
	active: z.boolean().optional().default(true),
})

export type CreateProductDto = z.infer<typeof createProductSchema>
