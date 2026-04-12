export type BillingMode = 'per_sale' | 'weekly' | 'biweekly' | 'monthly' | 'custom'

export interface Customer {
	id: string
	seller_id: string
	name: string
	email: string | null
	phone: string
	document: string | null
	address: Record<string, unknown>
	city: string
	state: string
	zip_code: string | null
	billing_day: number | null
	billing_mode: BillingMode
	createdAt: Date
	updatedAt: Date
}

export interface CreateCustomerData {
	seller_id: string
	name: string
	email: string | null
	phone: string
	document: string | null
	address: Record<string, unknown>
	city: string
	state: string
	zip_code: string | null
	billing_day?: number | null
	billing_mode?: BillingMode
}

export type UpdateCustomerData = Partial<CreateCustomerData>

export const CUSTOMER_REPOSITORY = Symbol('CUSTOMER_REPOSITORY')

export interface CustomerRepository {
	create(data: CreateCustomerData): Promise<Customer>
	findById(id: string): Promise<Customer | null>
	findByEmail(sellerId: string, email: string): Promise<Customer | null>
	findAll(sellerId?: string): Promise<Customer[]>
	update(id: string, data: UpdateCustomerData): Promise<Customer>
	delete(id: string): Promise<Customer>
}
