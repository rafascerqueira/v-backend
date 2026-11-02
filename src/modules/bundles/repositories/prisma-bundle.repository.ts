import { Injectable, NotFoundException } from '@nestjs/common'
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
						seller_id: true,
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

	/**
	 * Every bundle item must reference a live product of the bundle's own seller.
	 * Product ids are sequential, so without this a seller could attach another
	 * tenant's product and read its name/price back. Foreign or missing ids get
	 * the same 404 so existence isn't leaked.
	 */
	private async assertProductsOwnedBy(
		sellerId: string,
		items: Array<{ product_id: number }>,
	): Promise<void> {
		const productIds = [...new Set(items.map((item) => item.product_id))]
		const owned = await this.prisma.product.count({
			where: { id: { in: productIds }, seller_id: sellerId, deletedAt: null },
		})
		if (owned !== productIds.length) {
			throw new NotFoundException('Produto não encontrado')
		}
	}

	private toBundle(row: any): Bundle {
		// Read-side guard for rows written before the ownership check existed:
		// never serialize (or price) a product that belongs to another seller.
		const items = row.items
			.filter((item: any) => item.product?.seller_id === row.seller_id)
			.map(({ product: { seller_id: _sellerId, ...product }, ...item }: any) => ({
				...item,
				product,
			}))
		const { total_price, discounted_price } = this.computeTotals(items, row.discount_percent)
		return { ...row, items, total_price, discounted_price } as Bundle
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
		await this.assertProductsOwnedBy(data.seller_id, data.items)

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
		// Repo-level ownership gate (defense-in-depth alongside the service's findOne):
		// never mutate a bundle by bare id without confirming tenant ownership.
		const existing = await this.findById(id)
		if (!existing) throw new NotFoundException('Bundle not found')

		const { items, ...fields } = data

		// Validate against the bundle owner's seller (not the caller), so an admin
		// editing a seller's bundle can't mix in another tenant's products either.
		if (items !== undefined) {
			await this.assertProductsOwnedBy(existing.seller_id, items)
		}

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
		const existing = await this.findById(id)
		if (!existing) throw new NotFoundException('Bundle not found')
		await this.prisma.bundle.update({
			where: { id },
			data: { deletedAt: new Date() },
		})
	}
}
