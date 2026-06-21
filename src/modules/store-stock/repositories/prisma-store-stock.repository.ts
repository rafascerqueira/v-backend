import { Inject, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '@/shared/prisma/prisma.service'
import {
	BACKORDER_REPOSITORY,
	type BackorderRepository,
} from '@/shared/repositories/backorder.repository'
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
		@Inject(BACKORDER_REPOSITORY) private readonly backorderRepository: BackorderRepository,
	) {}

	private getTenantFilter() {
		if (this.tenantContext.isAdmin()) {
			return {}
		}
		return { seller_id: this.tenantContext.requireSellerId() }
	}

	async findAll(filter: Record<string, unknown>): Promise<StoreStockWithProduct[]> {
		const stocks = await this.prisma.store_stock.findMany({
			where: {
				...this.getTenantFilter(),
				...filter,
				product: { deletedAt: null },
			},
			orderBy: { product_id: 'asc' },
		})

		const productIds = stocks.map((s) => s.product_id)
		const products = await this.prisma.product.findMany({
			where: { id: { in: productIds }, deletedAt: null },
			select: { id: true, name: true, sku: true, category: true },
		})

		const productMap = new Map(products.map((p) => [p.id, p]))
		const owedMap = await this.backorderRepository.summaryByProductIds(productIds)

		return stocks.map((stock) => {
			const owed = owedMap.get(stock.product_id)
			return {
				...stock,
				product: productMap.get(stock.product_id) || null,
				isLowStock: stock.quantity <= stock.min_stock && stock.min_stock > 0,
				owed_quantity: owed?.owed ?? 0,
				pending_orders_count: owed?.pending_orders_count ?? 0,
			}
		}) as unknown as StoreStockWithProduct[]
	}

	async findByProduct(productId: number): Promise<StoreStock | null> {
		const stock = await this.prisma.store_stock.findUnique({
			where: { product_id: productId },
		})
		if (!stock) return null

		if (!this.tenantContext.isAdmin() && stock.seller_id !== this.tenantContext.requireSellerId()) {
			return null
		}

		return stock as unknown as StoreStock
	}

	async upsert(productId: number, data: UpdateStoreStockData): Promise<StoreStock> {
		const product = await this.prisma.product.findUnique({
			where: { id: productId },
			select: { seller_id: true },
		})

		if (!product) {
			throw new NotFoundException('Product not found')
		}

		// Deriving seller_id from the product is not an ownership check: without
		// this gate a seller could create/overwrite another tenant's stock row by
		// guessing a product id. Foreign product → 404 (never leak existence).
		if (
			!this.tenantContext.isAdmin() &&
			product.seller_id !== this.tenantContext.requireSellerId()
		) {
			throw new NotFoundException('Product not found')
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
