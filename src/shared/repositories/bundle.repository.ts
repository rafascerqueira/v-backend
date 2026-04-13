export interface BundleItem {
	id: number
	bundle_id: number
	product_id: number
	quantity: number
	product: {
		id: number
		name: string
		prices: Array<{ price: number; price_type: string; active: boolean }>
	}
}

export interface Bundle {
	id: number
	seller_id: string
	name: string
	description: string | null
	discount_percent: number
	total_price: number
	discounted_price: number
	active: boolean
	deletedAt: Date | null
	createdAt: Date
	updatedAt: Date
	items: BundleItem[]
}

export interface CreateBundleData {
	seller_id: string
	name: string
	description?: string
	discount_percent: number
	active?: boolean
	items: Array<{ product_id: number; quantity: number }>
}

export interface UpdateBundleData {
	name?: string
	description?: string
	discount_percent?: number
	active?: boolean
	items?: Array<{ product_id: number; quantity: number }>
}

export const BUNDLE_REPOSITORY = Symbol('BUNDLE_REPOSITORY')

export interface BundleRepository {
	findAll(): Promise<Bundle[]>
	findById(id: number): Promise<Bundle | null>
	create(data: CreateBundleData): Promise<Bundle>
	update(id: number, data: UpdateBundleData): Promise<Bundle>
	delete(id: number): Promise<void>
}
