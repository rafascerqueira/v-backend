export interface ProductPrice {
	id: number
	product_id: number
	price: number
	price_type: string
	valid_from: Date | null
	valid_to: Date | null
	active: boolean
	createdAt: Date
	updatedAt: Date
}

export interface CreateProductPriceData {
	product_id: number
	price: number
	price_type: string
	valid_from?: Date | null
	valid_to?: Date | null
	active?: boolean
}

export interface UpdateProductPriceData {
	price?: number
	price_type?: string
	valid_from?: Date | null
	valid_to?: Date | null
	active?: boolean
}

export const PRODUCT_PRICE_REPOSITORY = Symbol('PRODUCT_PRICE_REPOSITORY')

export interface ProductPriceRepository {
	findByProduct(productId: number): Promise<ProductPrice[]>
	findById(id: number): Promise<ProductPrice | null>
	create(data: CreateProductPriceData): Promise<ProductPrice>
	update(id: number, data: UpdateProductPriceData): Promise<ProductPrice>
	deactivate(id: number): Promise<ProductPrice>
}
