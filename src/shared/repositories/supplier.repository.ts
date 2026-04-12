export interface SupplierDebt {
	id: number
	supplier_id: string
	amount: number
	paid_amount: number
	description: string
	status: 'pending' | 'partial' | 'paid'
	due_date: Date | null
	createdAt: Date
	updatedAt: Date
}

export interface Supplier {
	id: string
	seller_id: string
	name: string
	email: string | null
	phone: string | null
	address: string | null
	notes: string | null
	active: boolean
	total_debt: number
	total_paid: number
	createdAt: Date
	updatedAt: Date
}

export interface CreateSupplierData {
	seller_id: string
	name: string
	email?: string
	phone?: string
	address?: string
	notes?: string
}

export interface UpdateSupplierData {
	name?: string
	email?: string
	phone?: string
	address?: string
	notes?: string
}

export interface CreateDebtData {
	amount: number
	description: string
	due_date?: string
}

export const SUPPLIER_REPOSITORY = Symbol('SUPPLIER_REPOSITORY')

export interface SupplierRepository {
	findAll(): Promise<Supplier[]>
	findById(id: string): Promise<Supplier | null>
	create(data: CreateSupplierData): Promise<Supplier>
	update(id: string, data: UpdateSupplierData): Promise<Supplier>
	delete(id: string): Promise<void>
	findDebts(supplierId: string): Promise<SupplierDebt[]>
	createDebt(supplierId: string, data: CreateDebtData): Promise<SupplierDebt>
	payDebt(debtId: number, amount: number): Promise<SupplierDebt>
}
