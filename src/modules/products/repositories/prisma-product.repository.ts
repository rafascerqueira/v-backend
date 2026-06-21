import { Inject, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '@/shared/prisma/prisma.service'
import {
	BACKORDER_REPOSITORY,
	type BackorderRepository,
} from '@/shared/repositories/backorder.repository'
import type {
	CreateProductData,
	Product,
	ProductRepository,
	UpdateProductData,
} from '@/shared/repositories/product.repository'
import { TenantContext } from '@/shared/tenant/tenant.context'

@Injectable()
export class PrismaProductRepository implements ProductRepository {
	constructor(
		private readonly prisma: PrismaService,
		private readonly tenantContext: TenantContext,
		@Inject(BACKORDER_REPOSITORY) private readonly backorderRepository: BackorderRepository,
	) {}

	private getTenantFilter() {
		if (this.tenantContext.isAdmin()) {
			return {}
		}
		return { seller_id: this.tenantContext.requireSellerId() }
	}

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
				allow_oversell: data.allow_oversell,
			},
		}) as unknown as Product
	}

	async findById(id: number): Promise<Product | null> {
		const product = await this.prisma.product.findUnique({
			where: { id },
		})
		if (!product) return null
		if (!this.tenantContext.isAdmin() && product.seller_id !== this.tenantContext.getSellerId()) {
			return null
		}
		return product as unknown as Product
	}

	async findAll(sellerId?: string): Promise<Product[]> {
		return this.prisma.product.findMany({
			where: {
				deletedAt: null,
				...this.getTenantFilter(),
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
		const {
			page,
			limit,
			search,
			category,
			status,
			sortBy = 'createdAt',
			sortOrder = 'desc',
		} = params
		const skip = (page - 1) * limit

		const where = {
			deletedAt: null,
			...this.getTenantFilter(),
			...(search && {
				OR: [
					{ name: { contains: search, mode: 'insensitive' as const } },
					{ sku: { contains: search, mode: 'insensitive' as const } },
					{ category: { contains: search, mode: 'insensitive' as const } },
				],
			}),
			...(category && {
				category: { equals: category, mode: 'insensitive' as const },
			}),
			...(status && { status }),
		}

		const [data, total] = await Promise.all([
			this.prisma.product.findMany({
				where,
				skip,
				take: limit,
				orderBy: { [sortBy]: sortOrder },
				include: {
					prices: {
						where: { active: true, price_type: 'sale' },
						orderBy: { createdAt: 'desc' },
						take: 1,
					},
					stock: true,
				},
			}),
			this.prisma.product.count({ where }),
		])

		// Surface units owed to open orders so the products list can show the
		// "aguardando reposição" badge and clamp the displayed stock to 0.
		const owedMap = await this.backorderRepository.summaryByProductIds(data.map((p) => p.id))
		const enriched = data.map((product) => {
			const owed = owedMap.get(product.id)
			if (!product.stock) return product
			return {
				...product,
				stock: {
					...product.stock,
					owed_quantity: owed?.owed ?? 0,
					pending_orders_count: owed?.pending_orders_count ?? 0,
				},
			}
		})

		return { data: enriched as unknown as Product[], total }
	}

	async findBySku(sellerId: string, sku: string): Promise<Product | null> {
		return this.prisma.product.findUnique({
			where: { seller_id_sku: { seller_id: sellerId, sku } },
		}) as unknown as Product | null
	}

	async update(id: number, data: UpdateProductData): Promise<Product> {
		const product = await this.findById(id)
		if (!product) {
			throw new NotFoundException('Product not found or access denied')
		}
		return this.prisma.product.update({
			where: { id },
			data: {
				...data,
				specifications: data.specifications as any,
			},
		}) as unknown as Product
	}

	async softDelete(id: number): Promise<Product> {
		const product = await this.findById(id)
		if (!product) {
			throw new NotFoundException('Product not found or access denied')
		}
		return this.prisma.product.update({
			where: { id },
			data: { deletedAt: new Date() },
		}) as unknown as Product
	}
}
