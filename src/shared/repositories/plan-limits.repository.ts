export const PLAN_LIMITS_REPOSITORY = Symbol('PLAN_LIMITS_REPOSITORY')

export interface PlanLimitsRepository {
	countProducts(sellerId: string): Promise<number>
	countCustomers(sellerId: string): Promise<number>
	countOrdersThisMonth(sellerId: string, startOfMonth: Date): Promise<number>
}
