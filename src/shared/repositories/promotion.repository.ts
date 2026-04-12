export interface PromotionProduct {
	id: number
	name: string
}

export interface Promotion {
	id: number
	seller_id: string
	product_id: number
	product: PromotionProduct
	discount_percent: number
	original_price: number
	promotional_price: number
	start_date: Date
	end_date: Date
	description: string | null
	status: 'active' | 'scheduled' | 'expired'
	createdAt: Date
	updatedAt: Date
}

export interface CreatePromotionData {
	seller_id: string
	product_id: number
	discount_percent: number
	original_price: number
	promotional_price: number
	start_date: Date
	end_date: Date
	description?: string
	status: 'active' | 'scheduled' | 'expired'
}

export const PROMOTION_REPOSITORY = Symbol('PROMOTION_REPOSITORY')

export interface PromotionRepository {
	findAll(): Promise<Promotion[]>
	findById(id: number): Promise<Promotion | null>
	create(data: CreatePromotionData): Promise<Promotion>
	end(id: number): Promise<Promotion>
	getLatestProductPrice(productId: number): Promise<number>
}
