export interface StoreStock {
	product_id: number
	seller_id: string
	quantity: number
	reserved_quantity: number
	min_stock: number
	max_stock: number
}

export interface StoreStockWithProduct extends StoreStock {
	product: { id: number; name: string; sku: string | null; category: string | null } | null
	isLowStock: boolean
}

export interface UpdateStoreStockData {
	quantity?: number
	reserved_quantity?: number
	min_stock?: number
	max_stock?: number
}

export const STORE_STOCK_REPOSITORY = Symbol('STORE_STOCK_REPOSITORY')

export interface StoreStockRepository {
	findAll(filter: Record<string, unknown>): Promise<StoreStockWithProduct[]>
	findByProduct(productId: number): Promise<StoreStock | null>
	upsert(productId: number, data: UpdateStoreStockData): Promise<StoreStock>
}
