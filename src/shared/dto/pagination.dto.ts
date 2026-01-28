import { z } from 'zod'

export const paginationSchema = z.object({
	page: z.coerce.number().min(1).default(1),
	limit: z.coerce.number().min(1).max(100).default(10),
	search: z.string().optional(),
	category: z.string().optional(),
	status: z.string().optional(),
	sortBy: z.string().optional(),
	sortOrder: z.enum(['asc', 'desc']).default('desc'),
})

export type PaginationDto = z.infer<typeof paginationSchema>

export interface PaginatedResponse<T> {
	data: T[]
	meta: {
		total: number
		page: number
		limit: number
		totalPages: number
		hasNextPage: boolean
		hasPrevPage: boolean
	}
}

export function createPaginatedResponse<T>(
	data: T[],
	total: number,
	page: number,
	limit: number,
): PaginatedResponse<T> {
	const totalPages = Math.ceil(total / limit)
	return {
		data,
		meta: {
			total,
			page,
			limit,
			totalPages,
			hasNextPage: page < totalPages,
			hasPrevPage: page > 1,
		},
	}
}
