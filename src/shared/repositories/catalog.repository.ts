export interface StoreInfo {
	id: string
	store_slug: string | null
	store_name: string | null
	store_description: string | null
	store_logo: string | null
	store_banner: string | null
	store_phone: string | null
	store_whatsapp: string | null
	name: string
}

export interface CatalogProduct {
	id: number
	name: string
	description: string | null
	category: string | null
	brand: string | null
	unit: string | null
	images: unknown
	specifications: unknown
	seller_id: string
}

export interface CatalogPrice {
	product_id: number
	price: number
	createdAt: Date
}

export interface CatalogActivePromotion {
	product_id: number
	promotional_price: number
}

export interface CatalogStock {
	product_id: number
	quantity: number
	reserved_quantity: number
}

export interface CatalogCustomer {
	id: string
	seller_id: string
	name: string
	email: string
	phone: string | null
	document: string | null
	address: unknown
	city: string | null
	state: string | null
	zip_code: string | null
	seller_store_slug?: string | null
}

export interface CatalogCustomerWithHash extends CatalogCustomer {
	seller_id: string
	password_hash: string | null
}

export interface CatalogOrderTracking {
	id: number
	order_number: string
	status: string
	payment_status: string
	total: number
	subtotal: number
	discount: number
	delivery_date: Date | null
	createdAt: Date
	updatedAt: Date
	store: { name: string | null; store_name: string | null } | null
	items: Array<{
		product: { id: number; name: string } | null
		quantity: number
		unit_price: number
		total: number
	}>
}

export type CatalogOrderStatus = 'pending' | 'confirmed' | 'shipping' | 'delivered' | 'canceled'
export type CatalogPaymentStatus = 'pending' | 'confirmed' | 'canceled'

export const CATALOG_REPOSITORY = Symbol('CATALOG_REPOSITORY')

export interface CatalogRepository {
	findStoreBySlug(slug: string): Promise<StoreInfo | null>
	findStoreIdBySlug(slug: string): Promise<{ id: string } | null>

	findActiveProducts(sellerId?: string): Promise<CatalogProduct[]>
	findActiveProductById(id: number): Promise<CatalogProduct | null>
	findActiveProductBySeller(productId: number, sellerId: string): Promise<CatalogProduct | null>

	findActivePrices(productIds: number[]): Promise<CatalogPrice[]>
	findLatestPrice(productId: number): Promise<CatalogPrice | null>
	findActivePromotions(productIds: number[]): Promise<CatalogActivePromotion[]>

	findStocks(productIds: number[]): Promise<CatalogStock[]>
	findStockByProduct(productId: number): Promise<CatalogStock | null>

	findCustomerById(id: string): Promise<CatalogCustomer | null>
	findCustomerByEmailOrPhone(
		emailOrPhone: string,
		sellerId: string,
	): Promise<CatalogCustomerWithHash | null>
	updateCustomerPasswordHash(customerId: string, hash: string): Promise<void>
	findCustomerByContact(
		email: string | null,
		phone: string | null,
		document: string | null,
		sellerId?: string,
	): Promise<CatalogCustomer | null>
	createCustomer(data: {
		seller_id: string
		name: string
		email: string | null
		phone: string | null
		document: string | null
		address: unknown
		city: string | null
		state: string | null
		zip_code: string | null
	}): Promise<CatalogCustomer>

	findOrderByNumber(orderNumber: string): Promise<CatalogOrderTracking | null>

	findLastOrderId(): Promise<number | null>
	createOrderWithItems(data: {
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
	}): Promise<{
		id: number
		order_number: string
		status: string
		total: number
		customer: { id: string; name: string; email: string; phone: string | null } | null
		Order_item: Array<{
			product: { id: number; name: string } | null
			quantity: number
			unit_price: number
			total: number
		}>
	}>
}
