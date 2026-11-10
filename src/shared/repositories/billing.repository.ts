export interface BillingRecord {
	id: number
	order_id: number
	/** Owner (denormalised from the order). */
	seller_id: string
	billing_number: string
	total_amount: number
	paid_amount: number
	payment_method: string
	payment_status: string
	status: string
	due_date: Date | null
	payment_date: Date | null
	notes: string | null
	createdAt: Date
	updatedAt: Date
}

export interface BillingWithOrder extends BillingRecord {
	order: {
		id: number
		order_number: string
		seller_id: string
		status: string
		customer?: { id: string; name: string }
	}
}

export interface CreateBillingData {
	order_id: number
	billing_number: string
	total_amount: number
	paid_amount: number
	payment_method: string
	payment_status: string
	status: string
	due_date?: Date
	payment_date?: Date
	notes?: string
}

// No paid_amount / payment_date: money only moves through the payment ledger
// (BillingPaymentRepository), and the database refuses other writes to paid_amount.
export interface UpdateBillingData {
	total_amount?: number
	payment_method?: string
	payment_status?: string
	status?: string
	due_date?: Date | null
	notes?: string
}

export interface UnbilledOrder {
	id: number
	order_number: string
	total: number
	seller_id: string
	createdAt: Date
}

export const BILLING_REPOSITORY = Symbol('BILLING_REPOSITORY')

export interface BillingRepository {
	findAll(filter: Record<string, unknown>): Promise<BillingWithOrder[]>
	findByOrderId(orderId: number, filter: Record<string, unknown>): Promise<BillingRecord[]>
	findById(id: number): Promise<BillingWithOrder | null>
	findUnbilledPerSaleOrders(): Promise<UnbilledOrder[]>
	create(data: CreateBillingData): Promise<BillingRecord>
	update(id: number, data: UpdateBillingData): Promise<BillingRecord>
	/** 404 missing/foreign; 409 HAS_PAYMENTS. Returns the owner (cache invalidation). */
	delete(id: number): Promise<{ sellerId: string }>
	verifyOrderAccess(
		orderId: number,
		sellerId: string | null,
		isAdmin: boolean,
	): Promise<{ id: number; seller_id: string } | null>
}
