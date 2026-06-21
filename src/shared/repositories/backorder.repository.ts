export type BackorderStatus = 'pending' | 'fulfilled' | 'canceled'

export interface Backorder {
	id: number
	seller_id: string
	order_id: number
	order_item_id: number
	product_id: number
	quantity: number
	fulfilled_quantity: number
	status: BackorderStatus
	fulfilledAt: Date | null
	createdAt: Date
	updatedAt: Date
}

// Enriched row for the order-waiting breakdown (the accordion on the products/stock
// pages and the GET /backorders list).
export interface BackorderWithRelations extends Backorder {
	order?: { id: number; order_number: string; status: string }
	product?: { id: number; name: string } | null
}

// Per-product aggregate consumed by the products + stock list endpoints so the
// frontend can show the "aguardando reposição" badge without an extra round-trip.
export interface BackorderSummary {
	// Units still owed = sum(quantity - fulfilled_quantity) over pending rows.
	owed: number
	pending_orders_count: number
}

export const BACKORDER_REPOSITORY = Symbol('BACKORDER_REPOSITORY')

export interface BackorderRepository {
	// Pending backorders for one product (tenant-scoped). Unknown/cross-tenant → [].
	findPendingByProduct(productId: number): Promise<BackorderWithRelations[]>
	// List backorders (tenant-scoped) optionally narrowed by product and/or status.
	list(params: { productId?: number; status?: BackorderStatus }): Promise<BackorderWithRelations[]>
	// owed/pending-orders summary keyed by product id (tenant-scoped). Products with
	// no pending backorders are simply absent from the map.
	summaryByProductIds(productIds: number[]): Promise<Map<number, BackorderSummary>>
}
