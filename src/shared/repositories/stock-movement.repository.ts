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

export interface StockMovementRepository {
	findByProduct(productId: number): Promise<StockMovement[]>
	create(data: CreateStockMovementData): Promise<CreateStockMovementResult>
}
