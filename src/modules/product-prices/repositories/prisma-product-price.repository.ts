import { Injectable } from '@nestjs/common'
import { PrismaService } from '@/shared/prisma/prisma.service'
import type {
	CreateProductPriceData,
	ProductPrice,
	ProductPriceRepository,
	UpdateProductPriceData,
} from '@/shared/repositories/product-price.repository'

@Injectable()
export class PrismaProductPriceRepository implements ProductPriceRepository {
	constructor(private readonly prisma: PrismaService) {}

	async findByProduct(productId: number): Promise<ProductPrice[]> {
		return this.prisma.product_price.findMany({
			where: { product_id: productId },
			orderBy: [{ valid_from: 'desc' }, { createdAt: 'desc' }],
		}) as unknown as ProductPrice[]
	}

	async findById(id: number): Promise<ProductPrice | null> {
		return this.prisma.product_price.findUnique({
			where: { id },
		}) as unknown as ProductPrice | null
	}

	async create(data: CreateProductPriceData): Promise<ProductPrice> {
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
		return this.prisma.product_price.update({
			where: { id },
			data: {
				...data,
				price_type: data.price_type as any,
			} as any,
		}) as unknown as ProductPrice
	}

	async deactivate(id: number): Promise<ProductPrice> {
		return this.prisma.product_price.update({
			where: { id },
			data: { active: false },
		}) as unknown as ProductPrice
	}
}
