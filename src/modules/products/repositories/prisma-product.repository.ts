import { Injectable } from '@nestjs/common'
import { PrismaService } from '@/shared/prisma/prisma.service'
import type {
	ProductRepository,
	Product,
	CreateProductData,
	UpdateProductData,
} from '@/shared/repositories/product.repository'

@Injectable()
export class PrismaProductRepository implements ProductRepository {
	constructor(private readonly prisma: PrismaService) {}

	async create(data: CreateProductData): Promise<Product> {
		return this.prisma.product.create({
			data: {
				seller_id: data.seller_id,
				name: data.name,
				description: data.description,
				sku: data.sku,
				category: data.category,
				brand: data.brand,
				unit: data.unit,
				specifications: data.specifications as any,
				images: data.images,
				active: data.active,
			},
		}) as unknown as Product
	}

	async findById(id: number): Promise<Product | null> {
		return this.prisma.product.findUnique({
			where: { id },
		}) as unknown as Product | null
	}

	async findAll(sellerId?: string): Promise<Product[]> {
		return this.prisma.product.findMany({
			where: { 
				deletedAt: null,
				...(sellerId && { seller_id: sellerId }),
			},
		}) as unknown as Product[]
	}

	async findAllPaginated(params: {
		page: number
		limit: number
		search?: string
		category?: string
		status?: string
		sortBy?: string
		sortOrder?: 'asc' | 'desc'
	}): Promise<{ data: Product[]; total: number }> {
		const { page, limit, search, category, status, sortBy = 'createdAt', sortOrder = 'desc' } = params
		const skip = (page - 1) * limit

		const where = {
			deletedAt: null,
			...(search && {
				OR: [
					{ name: { contains: search, mode: 'insensitive' as const } },
					{ sku: { contains: search, mode: 'insensitive' as const } },
					{ category: { contains: search, mode: 'insensitive' as const } },
				],
			}),
			...(category && { category: { equals: category, mode: 'insensitive' as const } }),
			...(status && { status }),
		}

		const [data, total] = await Promise.all([
			this.prisma.product.findMany({
				where,
				skip,
				take: limit,
				orderBy: { [sortBy]: sortOrder },
			}),
			this.prisma.product.count({ where }),
		])

		return { data: data as unknown as Product[], total }
	}

	async findBySku(sellerId: string, sku: string): Promise<Product | null> {
		return this.prisma.product.findUnique({
			where: { seller_id_sku: { seller_id: sellerId, sku } },
		}) as unknown as Product | null
	}

	async update(id: number, data: UpdateProductData): Promise<Product> {
		return this.prisma.product.update({
			where: { id },
			data: {
				...data,
				specifications: data.specifications as any,
			},
		}) as unknown as Product
	}

	async softDelete(id: number): Promise<Product> {
		return this.prisma.product.update({
			where: { id },
			data: { deletedAt: new Date() },
		}) as unknown as Product
	}
}
