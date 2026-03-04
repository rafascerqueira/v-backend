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

export const STOCK_MOVEMENT_REPOSITORY = Symbol('STOCK_MOVEMENT_REPOSITORY')

export interface StockMovementRepository {
	findByProduct(productId: number): Promise<StockMovement[]>
	create(data: CreateStockMovementData): Promise<StockMovement>
}
