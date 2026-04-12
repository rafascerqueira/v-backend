export interface BillingRecord {
	id: number
	order_id: number
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

export interface UpdateBillingData {
	total_amount?: number
	paid_amount?: number
	payment_method?: string
	payment_status?: string
	status?: string
	due_date?: Date | null
	payment_date?: Date | null
	notes?: string
}

export const BILLING_REPOSITORY = Symbol('BILLING_REPOSITORY')

export interface BillingRepository {
	findAll(filter: Record<string, unknown>): Promise<BillingWithOrder[]>
	findByOrderId(orderId: number, filter: Record<string, unknown>): Promise<BillingRecord[]>
	findById(id: number): Promise<BillingWithOrder | null>
	create(data: CreateBillingData): Promise<BillingRecord>
	update(id: number, data: UpdateBillingData): Promise<BillingRecord>
	verifyOrderAccess(
		orderId: number,
		sellerId: string | null,
		isAdmin: boolean,
	): Promise<{ id: number; seller_id: string } | null>
}
