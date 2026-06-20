import { z } from 'zod'

export const createProductSchema = z.object({
	name: z.string().min(1, 'Nome é obrigatório').max(100),
	description: z.string().optional().or(z.literal('')),
	sku: z.string().optional().or(z.literal('')),
	category: z.string().optional().or(z.literal('')),
	brand: z.string().optional().or(z.literal('')),
	unit: z.string().max(20).default('un'),
	specifications: z
		.object({
			imported: z.boolean().optional(),
			moreinfo: z.string().optional(),
		})
		.optional()
		.default({}),
	images: z.array(z.url('URL de imagem inválida')).optional().default([]),
	active: z.boolean().optional().default(true),
	// When true, sales of this product are never blocked by insufficient stock;
	// stock simply decrements below zero. Default keeps the "block on shortage"
	// behavior for stock-tracked products.
	allow_oversell: z.boolean().optional().default(false),
})

export type CreateProductDto = z.infer<typeof createProductSchema>
