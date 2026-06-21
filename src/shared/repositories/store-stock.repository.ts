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
	// Units owed to open orders (sold past stock) and how many orders are waiting.
	// The frontend shows `quantity` clamped to 0 plus an "aguardando reposição" badge.
	owed_quantity: number
	pending_orders_count: number
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
