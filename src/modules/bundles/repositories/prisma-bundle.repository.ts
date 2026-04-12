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
			select: { id: true, bundle_id: true, product_id: true, quantity: true },
		},
	}

	async findAll(): Promise<Bundle[]> {
		const rows = await this.prisma.bundle.findMany({
			where: { deletedAt: null, ...this.getTenantFilter() },
			include: this.include,
			orderBy: { createdAt: 'desc' },
		})
		return rows as unknown as Bundle[]
	}

	async findById(id: number): Promise<Bundle | null> {
		const row = await this.prisma.bundle.findFirst({
			where: { id, deletedAt: null, ...this.getTenantFilter() },
			include: this.include,
		})
		return row ? (row as unknown as Bundle) : null
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
		return row as unknown as Bundle
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

		return row as unknown as Bundle
	}

	async delete(id: number): Promise<void> {
		await this.prisma.bundle.update({
			where: { id },
			data: { deletedAt: new Date() },
		})
	}
}
