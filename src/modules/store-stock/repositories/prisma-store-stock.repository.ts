import { Injectable } from '@nestjs/common'
import { PrismaService } from '@/shared/prisma/prisma.service'
import type {
	StoreStock,
	StoreStockRepository,
	StoreStockWithProduct,
	UpdateStoreStockData,
} from '@/shared/repositories/store-stock.repository'
import { TenantContext } from '@/shared/tenant/tenant.context'

@Injectable()
export class PrismaStoreStockRepository implements StoreStockRepository {
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

	async findAll(filter: Record<string, unknown>): Promise<StoreStockWithProduct[]> {
		const stocks = await this.prisma.store_stock.findMany({
			where: { ...this.getTenantFilter(), ...filter },
			orderBy: { product_id: 'asc' },
		})

		const productIds = stocks.map((s) => s.product_id)
		const products = await this.prisma.product.findMany({
			where: { id: { in: productIds } },
			select: { id: true, name: true, sku: true, category: true },
		})

		const productMap = new Map(products.map((p) => [p.id, p]))

		return stocks.map((stock) => ({
			...stock,
			product: productMap.get(stock.product_id) || null,
			isLowStock: stock.quantity <= stock.min_stock && stock.min_stock > 0,
		})) as unknown as StoreStockWithProduct[]
	}

	async findByProduct(productId: number): Promise<StoreStock | null> {
		return this.prisma.store_stock.findUnique({
			where: { product_id: productId },
		}) as unknown as StoreStock | null
	}

	async upsert(productId: number, data: UpdateStoreStockData): Promise<StoreStock> {
		const product = await this.prisma.product.findUnique({
			where: { id: productId },
			select: { seller_id: true },
		})

		if (!product) {
			throw new Error('Product not found')
		}

		return this.prisma.store_stock.upsert({
			where: { product_id: productId },
			create: {
				seller_id: product.seller_id,
				product_id: productId,
				quantity: 0,
				reserved_quantity: 0,
				min_stock: 0,
				max_stock: 0,
				...data,
			},
			update: { ...data },
		}) as unknown as StoreStock
	}
}
