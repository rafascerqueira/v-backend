import { Injectable } from '@nestjs/common'
import { PrismaService } from '@/shared/prisma/prisma.service'
import type {
	CatalogActivePromotion,
	CatalogCustomer,
	CatalogCustomerWithHash,
	CatalogOrderStatus,
	CatalogOrderTracking,
	CatalogPaymentStatus,
	CatalogPrice,
	CatalogProduct,
	CatalogRepository,
	CatalogStock,
	StoreInfo,
} from '@/shared/repositories/catalog.repository'

@Injectable()
export class PrismaCatalogRepository implements CatalogRepository {
	constructor(private readonly prisma: PrismaService) {}

	async findStoreBySlug(slug: string): Promise<StoreInfo | null> {
		return this.prisma.account.findUnique({
			where: { store_slug: slug },
			select: {
				id: true,
				name: true,
				store_slug: true,
				store_name: true,
				store_description: true,
				store_logo: true,
				store_banner: true,
				store_phone: true,
				store_whatsapp: true,
			},
		}) as unknown as StoreInfo | null
	}

	async findStoreIdBySlug(slug: string): Promise<{ id: string } | null> {
		return this.prisma.account.findUnique({
			where: { store_slug: slug },
			select: { id: true },
		})
	}

	async findActiveProducts(sellerId?: string): Promise<CatalogProduct[]> {
		return this.prisma.product.findMany({
			where: {
				active: true,
				deletedAt: null,
				...(sellerId && { seller_id: sellerId }),
			},
			orderBy: { name: 'asc' },
		}) as unknown as CatalogProduct[]
	}

	async findActiveProductById(id: number): Promise<CatalogProduct | null> {
		return this.prisma.product.findFirst({
			where: { id, active: true, deletedAt: null },
		}) as unknown as CatalogProduct | null
	}

	async findActiveProductBySeller(
		productId: number,
		sellerId: string,
	): Promise<CatalogProduct | null> {
		return this.prisma.product.findFirst({
			where: {
				id: productId,
				seller_id: sellerId,
				active: true,
				deletedAt: null,
			},
		}) as unknown as CatalogProduct | null
	}

	async findActivePrices(productIds: number[]): Promise<CatalogPrice[]> {
		return this.prisma.product_price.findMany({
			where: {
				product_id: { in: productIds },
				active: true,
				price_type: 'sale',
				OR: [{ valid_from: null }, { valid_from: { lte: new Date() } }],
			},
			orderBy: { createdAt: 'desc' },
		}) as unknown as CatalogPrice[]
	}

	async findActivePromotions(productIds: number[]): Promise<CatalogActivePromotion[]> {
		const now = new Date()
		return this.prisma.promotion.findMany({
			where: {
				product_id: { in: productIds },
				start_date: { lte: now },
				end_date: { gte: now },
				status: { not: 'expired' },
			},
			select: { product_id: true, promotional_price: true },
			orderBy: { createdAt: 'desc' },
		}) as unknown as CatalogActivePromotion[]
	}

	async findLatestPrice(productId: number): Promise<CatalogPrice | null> {
		return this.prisma.product_price.findFirst({
			where: {
				product_id: productId,
				active: true,
				price_type: 'sale',
				OR: [{ valid_from: null }, { valid_from: { lte: new Date() } }],
			},
			orderBy: { createdAt: 'desc' },
		}) as unknown as CatalogPrice | null
	}

	async findStocks(productIds: number[]): Promise<CatalogStock[]> {
		return this.prisma.store_stock.findMany({
			where: { product_id: { in: productIds } },
		}) as unknown as CatalogStock[]
	}

	async findStockByProduct(productId: number): Promise<CatalogStock | null> {
		return this.prisma.store_stock.findUnique({
			where: { product_id: productId },
		}) as unknown as CatalogStock | null
	}

	async findCustomerById(id: string): Promise<CatalogCustomer | null> {
		const result = await this.prisma.customer.findUnique({
			where: { id },
			select: {
				id: true,
				seller_id: true,
				name: true,
				email: true,
				phone: true,
				document: true,
				address: true,
				city: true,
				state: true,
				zip_code: true,
				seller: { select: { store_slug: true } },
			},
		})
		if (!result) return null
		const { seller, ...customer } = result
		return { ...customer, seller_store_slug: seller.store_slug } as unknown as CatalogCustomer
	}

	async findCustomerByEmailOrPhone(
		emailOrPhone: string,
		sellerId: string,
	): Promise<CatalogCustomerWithHash | null> {
		return this.prisma.customer.findFirst({
			where: {
				seller_id: sellerId,
				OR: [{ email: emailOrPhone }, { phone: emailOrPhone }],
			},
			select: {
				id: true,
				seller_id: true,
				name: true,
				email: true,
				phone: true,
				document: true,
				address: true,
				city: true,
				state: true,
				zip_code: true,
				password_hash: true,
			},
		}) as unknown as CatalogCustomerWithHash | null
	}

	async updateCustomerPasswordHash(customerId: string, hash: string): Promise<void> {
		await this.prisma.customer.update({
			where: { id: customerId },
			data: { password_hash: hash },
		})
	}

	async findOrderByNumber(orderNumber: string): Promise<CatalogOrderTracking | null> {
		const order = await this.prisma.order.findFirst({
			where: { order_number: orderNumber },
			select: {
				id: true,
				order_number: true,
				status: true,
				payment_status: true,
				total: true,
				subtotal: true,
				discount: true,
				delivery_date: true,
				createdAt: true,
				updatedAt: true,
				seller: {
					select: { name: true, store_name: true },
				},
				Order_item: {
					select: {
						product: { select: { id: true, name: true } },
						quantity: true,
						unit_price: true,
						total: true,
					},
				},
			},
		})
		if (!order) return null
		return {
			id: order.id,
			order_number: order.order_number,
			status: order.status,
			payment_status: order.payment_status,
			total: order.total,
			subtotal: order.subtotal,
			discount: order.discount,
			delivery_date: order.delivery_date,
			createdAt: order.createdAt,
			updatedAt: order.updatedAt,
			store: order.seller,
			items: order.Order_item,
		}
	}

	async findCustomerByContact(
		email: string,
		phone: string | null,
		document: string | null,
		sellerId?: string,
	): Promise<CatalogCustomer | null> {
		return this.prisma.customer.findFirst({
			where: {
				...(sellerId ? { seller_id: sellerId } : {}),
				OR: [{ email }, ...(phone ? [{ phone }] : []), ...(document ? [{ document }] : [])],
			},
		}) as unknown as CatalogCustomer | null
	}

	async createCustomer(data: {
		seller_id: string
		name: string
		email: string
		phone: string | null
		document: string | null
		address: unknown
		city: string | null
		state: string | null
		zip_code: string | null
	}): Promise<CatalogCustomer> {
		return this.prisma.customer.create({
			data: data as any,
		}) as unknown as CatalogCustomer
	}

	async findLastOrderId(): Promise<number | null> {
		const lastOrder = await this.prisma.order.findFirst({
			orderBy: { id: 'desc' },
			select: { id: true },
		})
		return lastOrder?.id ?? null
	}

	async createOrderWithItems(data: {
		seller_id: string
		order_number: string
		customer_id: string
		status: CatalogOrderStatus
		payment_status: CatalogPaymentStatus
		subtotal: number
		discount: number
		total: number
		notes: string
		metadata: unknown
		items: Array<{
			product_id: number
			quantity: number
			unit_price: number
			discount: number
			total: number
		}>
	}) {
		return this.prisma.order.create({
			data: {
				seller_id: data.seller_id,
				order_number: data.order_number,
				customer_id: data.customer_id,
				status: data.status,
				payment_status: data.payment_status,
				subtotal: data.subtotal,
				discount: data.discount,
				total: data.total,
				notes: data.notes,
				metadata: data.metadata as any,
				Order_item: {
					create: data.items,
				},
			},
			include: {
				Order_item: {
					include: {
						product: {
							select: { id: true, name: true },
						},
					},
				},
				customer: {
					select: { id: true, name: true, email: true, phone: true },
				},
			},
		}) as any
	}
}
