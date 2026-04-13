import { Injectable } from '@nestjs/common'
import { PrismaService } from '@/shared/prisma/prisma.service'
import type {
	Bundle,
	BundleRepository,
	CreateBundleData,
	UpdateBundleData,
} from '@/shared/repositories/bundle.repository'
import { TenantContext } from '@/shared/tenant/tenant.context'

@Injectable()
export class PrismaBundleRepository implements BundleRepository {
	constructor(
		private readonly prisma: PrismaService,
		private readonly tenantContext: TenantContext,
	) {}

	private getTenantFilter() {
		if (this.tenantContext.isAdmin()) return {}
		return { seller_id: this.tenantContext.requireSellerId() }
	}

	private readonly include = {
		items: {
			select: {
				id: true,
				bundle_id: true,
				product_id: true,
				quantity: true,
				product: {
					select: {
						id: true,
						name: true,
						prices: {
							where: { active: true, price_type: 'sale' },
							orderBy: { createdAt: 'desc' },
							take: 1,
							select: { price: true, price_type: true, active: true },
						},
					},
				},
			},
		},
	} as any

	private computeTotals(
		items: Array<{ quantity: number; product: { prices: Array<{ price: number }> } }>,
		discountPercent: number,
	): { total_price: number; discounted_price: number } {
		const total_price = items.reduce(
			(sum, item) => sum + (item.product.prices[0]?.price ?? 0) * item.quantity,
			0,
		)
		const discounted_price = Math.round(total_price * (1 - discountPercent / 100))
		return { total_price, discounted_price }
	}

	private toBundle(row: any): Bundle {
		const { total_price, discounted_price } = this.computeTotals(row.items, row.discount_percent)
		return { ...row, total_price, discounted_price } as Bundle
	}

	async findAll(): Promise<Bundle[]> {
		const rows = await this.prisma.bundle.findMany({
			where: { deletedAt: null, ...this.getTenantFilter() },
			include: this.include,
			orderBy: { createdAt: 'desc' },
		})
		return rows.map((r) => this.toBundle(r))
	}

	async findById(id: number): Promise<Bundle | null> {
		const row = await this.prisma.bundle.findFirst({
			where: { id, deletedAt: null, ...this.getTenantFilter() },
			include: this.include,
		})
		return row ? this.toBundle(row) : null
	}

	async create(data: CreateBundleData): Promise<Bundle> {
		const row = await this.prisma.bundle.create({
			data: {
				seller_id: data.seller_id,
				name: data.name,
				description: data.description,
				discount_percent: data.discount_percent,
				active: data.active ?? true,
				items: {
					create: data.items.map((item) => ({
						product_id: item.product_id,
						quantity: item.quantity,
					})),
				},
			},
			include: this.include,
		})
		return this.toBundle(row)
	}

	async update(id: number, data: UpdateBundleData): Promise<Bundle> {
		const { items, ...fields } = data

		const row = await this.prisma.$transaction(async (tx) => {
			if (items !== undefined) {
				await tx.bundle_item.deleteMany({ where: { bundle_id: id } })
			}

			return tx.bundle.update({
				where: { id },
				data: {
					...fields,
					...(items !== undefined && {
						items: {
							create: items.map((item) => ({
								product_id: item.product_id,
								quantity: item.quantity,
							})),
						},
					}),
				},
				include: this.include,
			})
		})

		return this.toBundle(row)
	}

	async delete(id: number): Promise<void> {
		await this.prisma.bundle.update({
			where: { id },
			data: { deletedAt: new Date() },
		})
	}
}
