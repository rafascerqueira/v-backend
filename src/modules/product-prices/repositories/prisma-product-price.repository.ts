import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '@/shared/prisma/prisma.service'
import type {
	CreateProductPriceData,
	PriceHistoryEntry,
	ProductPrice,
	ProductPriceRepository,
	UpdateProductPriceData,
} from '@/shared/repositories/product-price.repository'
import { TenantContext } from '@/shared/tenant/tenant.context'

@Injectable()
export class PrismaProductPriceRepository implements ProductPriceRepository {
	constructor(
		private readonly prisma: PrismaService,
		private readonly tenantContext: TenantContext,
	) {}

	private getTenantFilter() {
		if (this.tenantContext.isAdmin()) {
			return {}
		}
		return { seller_id: this.tenantContext.requireSellerId() }
	}

	private async verifyProductOwnership(productId: number): Promise<void> {
		const product = await this.prisma.product.findFirst({
			where: { id: productId, ...this.getTenantFilter() },
		})
		if (!product) throw new NotFoundException('Product not found')
	}

	async findByProduct(productId: number): Promise<ProductPrice[]> {
		await this.verifyProductOwnership(productId)

		return this.prisma.product_price.findMany({
			where: { product_id: productId },
			orderBy: [{ valid_from: 'desc' }, { createdAt: 'desc' }],
		}) as unknown as ProductPrice[]
	}

	async findById(id: number): Promise<ProductPrice | null> {
		const price = await this.prisma.product_price.findUnique({
			where: { id },
			include: { product: { select: { seller_id: true } } },
		})
		if (!price) return null

		if (!this.tenantContext.isAdmin()) {
			const sellerId = this.tenantContext.requireSellerId()
			if ((price as any).product.seller_id !== sellerId) return null
		}

		return price as unknown as ProductPrice
	}

	async create(data: CreateProductPriceData): Promise<ProductPrice> {
		await this.verifyProductOwnership(data.product_id)

		return this.prisma.product_price.create({
			data: {
				product_id: data.product_id,
				price: data.price,
				price_type: data.price_type as any,
				valid_from: data.valid_from,
				valid_to: data.valid_to,
				active: data.active,
			},
		}) as unknown as ProductPrice
	}

	async update(id: number, data: UpdateProductPriceData): Promise<ProductPrice> {
		const existing = await this.findById(id)
		if (!existing) throw new NotFoundException('Price not found')

		return this.prisma.product_price.update({
			where: { id },
			data: {
				...data,
				price_type: data.price_type as any,
			} as any,
		}) as unknown as ProductPrice
	}

	async deactivate(id: number): Promise<ProductPrice> {
		const existing = await this.findById(id)
		if (!existing) throw new NotFoundException('Price not found')

		return this.prisma.product_price.update({
			where: { id },
			data: { active: false },
		}) as unknown as ProductPrice
	}

	async findPriceHistory(productId: number): Promise<PriceHistoryEntry[]> {
		await this.verifyProductOwnership(productId)

		const records = await this.prisma.product_price.findMany({
			where: { product_id: productId },
			orderBy: { createdAt: 'asc' },
		})

		return records
			.map((record, index) => ({
				id: record.id,
				old_price: index === 0 ? 0 : records[index - 1].price,
				new_price: record.price,
				change_type: 'manual' as const,
				changed_at: record.createdAt,
			}))
			.reverse()
	}
}
