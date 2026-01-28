export interface Product {
	id: number;
	seller_id: string;
	name: string;
	description: string | null;
	sku: string | null;
	category: string | null;
	brand: string | null;
	unit: string;
	specifications: Record<string, unknown>;
	images: string[];
	active: boolean;
	deletedAt: Date | null;
	createdAt: Date;
	updatedAt: Date;
}

export interface CreateProductData {
	seller_id: string;
	name: string;
	description?: string;
	sku?: string;
	category?: string;
	brand?: string;
	unit: string;
	specifications?: Record<string, unknown>;
	images?: string[];
	active?: boolean;
}

export type UpdateProductData = Partial<CreateProductData>;

export const PRODUCT_REPOSITORY = Symbol("PRODUCT_REPOSITORY");

export interface ProductRepository {
	create(data: CreateProductData): Promise<Product>;
	findById(id: number): Promise<Product | null>;
	findAll(sellerId?: string): Promise<Product[]>;
	findAllPaginated(params: {
		page: number;
		limit: number;
		search?: string;
		category?: string;
		status?: string;
		sortBy?: string;
		sortOrder?: "asc" | "desc";
	}): Promise<{ data: Product[]; total: number }>;
	findBySku(sellerId: string, sku: string): Promise<Product | null>;
	update(id: number, data: UpdateProductData): Promise<Product>;
	softDelete(id: number): Promise<Product>;
}
