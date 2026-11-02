export interface StockMovement {
	id: number
	movement_type: string
	reference_type: string
	reference_id: number
	product_id: number
	quantity: number
	createdAt: Date
}

export interface CreateStockMovementData {
	movement_type: string
	reference_type: string
	reference_id: number
	product_id: number
	quantity: number
}

// An order that became fully covered by an incoming stock arrival, so the service
// can tell the seller it's ready to finalize.
export interface FulfilledBackorderInfo {
	seller_id: string
	order_id: number
	order_number: string
	product_id: number
	product_name: string
	quantity: number
}

// create() returns the movement plus any backorders an `in` movement fulfilled,
// keeping the notification (a side effect) in the service layer.
export interface CreateStockMovementResult {
	movement: StockMovement
	fulfilled: FulfilledBackorderInfo[]
}

export const STOCK_MOVEMENT_REPOSITORY = Symbol('STOCK_MOVEMENT_REPOSITORY')

/**
 * Every stock change is a movement applied under the stock row lock (FOR UPDATE)
 * with an atomic increment/decrement, plus a stock.moved event in the same
 * transaction (side effects such as the "reposição alocada" notification come from
 * it). Tenant-scoped through the product.
 */
export interface StockMovementRepository {
	findByProduct(productId: number): Promise<StockMovement[]>
	create(data: CreateStockMovementData): Promise<CreateStockMovementResult>
	/**
	 * Sets the on-hand quantity (PATCH /store-stock) by recording an `adjustment`
	 * movement of the difference, computed under the lock, so the movement history
	 * always adds up to the stock. Null when the quantity is already `target`.
	 * 404 for another seller's product.
	 */
	adjustTo(productId: number, target: number): Promise<CreateStockMovementResult | null>
}
