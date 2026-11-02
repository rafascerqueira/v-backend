import type { IdempotencyRequest } from '@/shared/idempotency/idempotency'

export interface Order {
	id: number
	seller_id: string
	customer_id: string
	order_number: string
	notes: string | null
	subtotal: number
	discount: number
	total: number
	status: string
	/** Storefront orders only: the public tracking link handle. */
	tracking_token?: string | null
	createdAt: Date
	updatedAt: Date
}

export interface OrderWithRelations extends Order {
	Order_item: OrderItem[]
	Billing?: Billing[]
	customer?: { id: string; name: string; email: string | null; phone?: string | null }
}

export interface OrderItem {
	id: number
	order_id: number
	product_id: number
	quantity: number
	unit_price: number
	discount: number
	total: number
	product?: { id: number; name: string } | null
	// Present when this line was sold past stock — drives the per-item "aguardando
	// reposição / reposto" status in the order detail view.
	backorder?: {
		id: number
		quantity: number
		fulfilled_quantity: number
		status: string
	} | null
}

export interface Billing {
	id: number
	order_id: number
	status: string
	payment_status: string
}

/** Where an order came from: the seller's dashboard or the public storefront. */
export type OrderSource = 'dashboard' | 'storefront'

export interface CreateOrderData {
	seller_id: string
	customer_id: string
	notes?: string
	subtotal: number
	discount: number
	total: number
	items: {
		product_id: number
		quantity: number
		unit_price: number
		discount: number
		total: number
	}[]
	source: OrderSource
	/**
	 * Honour products' allow_oversell. Seller-only: the storefront passes false, so a
	 * short stock-tracked item is always a 400 there.
	 */
	allowOversell: boolean
	metadata?: Record<string, unknown>
	/** Storefront orders: the unguessable handle for the public tracking link. */
	tracking_token?: string
	// Optional charge created atomically with the order (per_sale billing mode).
	billing?: CreateOrderBillingData
	idempotency?: IdempotencyRequest
}

// An item that was sold past its available stock because the product is flagged
// allow_oversell (stock went negative). Carried in the order.created event so the
// seller is notified that these units are pending delivery.
export interface OversoldItem {
	product_id: number
	product_name: string
	available: number
	requested: number
}

/**
 * The order is numbered (PED-n / COB-n) inside the transaction. `replayed` means the
 * Idempotency-Key was already used with the same body: nothing was written and
 * `orderId` is the original order.
 */
export interface CreateOrderResult {
	orderId: number
	replayed: boolean
}

/** One entry of an order's timeline (GET /orders/:id/events). */
export interface OrderEvent {
	id: string
	event_type: string
	occurred_at: Date
	payload: Record<string, unknown>
}

export interface CreateOrderBillingData {
	total_amount: number
	paid_amount: number
	payment_method: string
	payment_status: string
	status: string
	due_date?: Date
}

export interface CreateOrderItemData {
	order_id: number
	product_id: number
	quantity: number
	unit_price: number
	discount: number
	total: number
}

export const ORDER_REPOSITORY = Symbol('ORDER_REPOSITORY')

export interface OrderRepository {
	create(data: CreateOrderData): Promise<CreateOrderResult>
	addItem(data: CreateOrderItemData): Promise<OrderItem>
	findById(id: number): Promise<OrderWithRelations | null>
	findAll(filter: Record<string, unknown>): Promise<OrderWithRelations[]>
	updateStatus(
		id: number,
		status: string,
		billingUpdate?: {
			status: string
			payment_status: string
			payment_date?: Date
			paid_amount?: number
		},
	): Promise<Order>
	/** 409 HAS_PAYMENTS when a charge of the order has money recorded on it. */
	delete(id: number): Promise<Order>
	/** The order's domain events, oldest first; null when missing or another tenant's. */
	findEvents(orderId: number): Promise<OrderEvent[] | null>
}
