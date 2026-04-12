import { Injectable } from '@nestjs/common'
import { PrismaService } from '@/shared/prisma/prisma.service'
import type {
	CreatePromotionData,
	Promotion,
	PromotionRepository,
} from '@/shared/repositories/promotion.repository'
import { TenantContext } from '@/shared/tenant/tenant.context'

@Injectable()
export class PrismaPromotionRepository implements PromotionRepository {
	constructor(
		private readonly prisma: PrismaService,
		private readonly tenantContext: TenantContext,
	) {}

	private getTenantFilter() {
		if (this.tenantContext.isAdmin()) return {}
		return { seller_id: this.tenantContext.requireSellerId() }
	}

	private readonly include = {
		product: { select: { id: true, name: true } },
	}

	private computeStatus(row: {
		start_date: Date
		end_date: Date
		status: string
	}): 'active' | 'scheduled' | 'expired' {
		if (row.status === 'expired') return 'expired'
		const now = new Date()
		if (now < row.start_date) return 'scheduled'
		if (now > row.end_date) return 'expired'
		return 'active'
	}

	async findAll(): Promise<Promotion[]> {
		const rows = await this.prisma.promotion.findMany({
			where: this.getTenantFilter(),
			include: this.include,
			orderBy: { createdAt: 'desc' },
		})
		return rows.map((r) => ({ ...r, status: this.computeStatus(r) })) as unknown as Promotion[]
	}

	async findById(id: number): Promise<Promotion | null> {
		const row = await this.prisma.promotion.findFirst({
			where: { id, ...this.getTenantFilter() },
			include: this.include,
		})
		if (!row) return null
		return { ...row, status: this.computeStatus(row) } as unknown as Promotion
	}

	async create(data: CreatePromotionData): Promise<Promotion> {
		const row = await this.prisma.promotion.create({
			data: {
				seller_id: data.seller_id,
				product_id: data.product_id,
				discount_percent: data.discount_percent,
				original_price: data.original_price,
				promotional_price: data.promotional_price,
				start_date: data.start_date,
				end_date: data.end_date,
				description: data.description,
				status: data.status,
			},
			include: this.include,
		})
		return { ...row, status: this.computeStatus(row) } as unknown as Promotion
	}

	async end(id: number): Promise<Promotion> {
		const row = await this.prisma.promotion.update({
			where: { id },
			data: { status: 'expired' },
			include: this.include,
		})
		return { ...row, status: 'expired' as const } as unknown as Promotion
	}

	async getLatestProductPrice(productId: number): Promise<number> {
		const price = await this.prisma.product_price.findFirst({
			where: { product_id: productId, active: true, price_type: 'sale' },
			orderBy: { createdAt: 'desc' },
		})
		return price?.price ?? 0
	}
}
