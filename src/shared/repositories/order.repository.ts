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
	createdAt: Date
	updatedAt: Date
}

export interface OrderWithRelations extends Order {
	Order_item: OrderItem[]
	Billing?: Billing[]
	customer?: { id: string; name: string; email: string | null }
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

export interface CreateOrderData {
	seller_id: string
	customer_id: string
	order_number: string
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
	// Optional charge created atomically with the order (per_sale billing mode).
	billing?: CreateOrderBillingData
}

// An item that was sold past its available stock because the product is flagged
// allow_oversell. Surfaced from create() so the service can notify the seller that
// these units are pending delivery (stock has gone negative).
export interface OversoldItem {
	product_id: number
	product_name: string
	available: number
	requested: number
}

// create() returns the order plus any oversold items, keeping the notification
// (a side effect) in the service layer instead of the repository transaction.
export interface CreateOrderResult {
	order: OrderWithRelations
	oversold: OversoldItem[]
}

export interface CreateOrderBillingData {
	billing_number: string
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
	delete(id: number): Promise<Order>
}
