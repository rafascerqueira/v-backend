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
	create(data: CreateOrderData): Promise<OrderWithRelations>
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
