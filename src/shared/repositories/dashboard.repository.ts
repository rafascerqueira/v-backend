export interface DashboardStats {
	totalProducts: number
	totalCustomers: number
	totalOrders: number
	pendingOrders: number
	recentOrders: Array<{
		id: number
		order_number: string
		total: number
		status: string
		createdAt: Date
		customer: { name: string } | null
	}>
	topProducts: Array<{ product_id: number; _sum: { quantity: number | null } }>
	totalRevenue: number
	productNames: Map<number, string>
}

export const DASHBOARD_REPOSITORY = Symbol('DASHBOARD_REPOSITORY')

export interface DashboardRepository {
	getStats(tenantFilter: Record<string, unknown>): Promise<DashboardStats>
}
