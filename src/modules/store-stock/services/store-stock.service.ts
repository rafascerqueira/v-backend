import { Injectable } from "@nestjs/common";
import { PrismaService } from "@/shared/prisma/prisma.service";
import { TenantContext } from "@/shared/tenant/tenant.context";
import type { UpdateStoreStockDto } from "../dto/update-store-stock.dto";

@Injectable()
export class StoreStockService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly tenantContext: TenantContext,
	) {}

	private getTenantFilter() {
		if (this.tenantContext.isAdmin()) {
			return {};
		}
		return { seller_id: this.tenantContext.requireSellerId() };
	}

	async findAll() {
		const stocks = await this.prisma.store_stock.findMany({
			where: this.getTenantFilter(),
			orderBy: { product_id: "asc" },
		});

		const productIds = stocks.map((s) => s.product_id);
		const products = await this.prisma.product.findMany({
			where: { id: { in: productIds } },
			select: { id: true, name: true, sku: true, category: true },
		});

		const productMap = new Map(products.map((p) => [p.id, p]));

		return stocks.map((stock) => ({
			...stock,
			product: productMap.get(stock.product_id) || null,
			isLowStock: stock.quantity <= stock.min_stock && stock.min_stock > 0,
		}));
	}

	async getByProduct(productId: number) {
		return this.prisma.store_stock.findUnique({
			where: { product_id: productId },
		});
	}

	async upsert(productId: number, dto: UpdateStoreStockDto) {
		// Get seller_id from product
		const product = await this.prisma.product.findUnique({
			where: { id: productId },
			select: { seller_id: true },
		});

		if (!product) {
			throw new Error("Product not found");
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
				...dto,
			},
			update: { ...dto },
		});
	}
}
