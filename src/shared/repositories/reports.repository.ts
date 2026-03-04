export interface OrderWithItems {
	id: number
	order_number: string
	total: number
	status: string
	createdAt: Date
	customer?: { name: string } | null
	Order_item: Array<{
		product_id: number
		quantity: number
		total: number
		product: { id: number; name: string; sku?: string | null; category: string | null } | null
	}>
}

export interface OrderBasic {
	id: number
	total: number
	status: string
	createdAt: Date
}

export interface OrderForCharts {
	createdAt: Date
	total: number
	status: string
}

export interface AggregateResult {
	_sum: { total: number | null }
	_count: number
}

export interface CustomerOrderGroup {
	customer_id: string
	_sum: { total: number | null }
	_count: { id: number }
}

export interface CustomerBasic {
	id: string
	name: string
	email: string
	city: string | null
	state: string | null
}

export const REPORTS_REPOSITORY = Symbol('REPORTS_REPOSITORY')

export interface ReportsRepository {
	findOrdersWithItems(
		tenantFilter: Record<string, unknown>,
		dateFilter?: { gte: Date; lte: Date },
	): Promise<OrderWithItems[]>

	findOrdersBasic(
		tenantFilter: Record<string, unknown>,
		dateFilter?: { gte: Date; lte: Date },
	): Promise<OrderBasic[]>

	findOrdersForCharts(
		tenantFilter: Record<string, unknown>,
		dateFilter: { gte: Date; lte: Date },
	): Promise<OrderForCharts[]>

	aggregateOrders(
		tenantFilter: Record<string, unknown>,
		dateFilter: { gte: Date; lte?: Date },
	): Promise<AggregateResult>

	countCustomers(
		tenantFilter: Record<string, unknown>,
		dateFilter?: { gte: Date; lte?: Date },
	): Promise<number>

	countAllCustomers(tenantFilter: Record<string, unknown>): Promise<number>
	countActiveCustomers(tenantFilter: Record<string, unknown>): Promise<number>

	groupOrdersByCustomer(
		tenantFilter: Record<string, unknown>,
		limit: number,
	): Promise<CustomerOrderGroup[]>

	findCustomersByIds(ids: string[]): Promise<CustomerBasic[]>
}
