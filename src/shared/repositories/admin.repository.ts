import type { PlanType } from '@/generated/prisma/client'

export interface AdminStats {
	totalAccounts: number
	totalCustomers: number
	totalProducts: number
	totalOrders: number
	ordersToday: number
	ordersThisMonth: number
	ordersLastMonth: number
	revenueThisMonth: number | null
	revenueLastMonth: number | null
	pendingOrders: number
	activeProducts: number
}

export interface AccountListItem {
	id: string
	name: string
	email: string
	role: string
	plan_type: string
	two_factor_enabled: boolean
	last_login_at: Date | null
	createdAt: Date
	updatedAt: Date
	_count: { products: number; customers: number; orders: number }
}

export interface AccountDetail extends AccountListItem {
	subscriptions: unknown[]
	usage_records: unknown[]
}

export interface AccountBasicInfo {
	id: string
	name: string
	email: string
	plan_type: string
}

export interface ActiveUser {
	id: string
	name: string
	email: string
	role: string
	plan_type: string
	last_login_at: Date | null
}

export interface SubscriptionStatsResult {
	byPlan: Array<{ plan_type: string; _count: { id: number } }>
	recentSubscriptions: unknown[]
	expiringSubscriptions: unknown[]
}

export interface AuditLogEntry {
	id: number
	action: string
	entity: string
	entity_id: string
	user_id: string
	old_value: unknown
	new_value: unknown
	metadata: unknown
	created_at: Date
}

export const ADMIN_REPOSITORY = Symbol('ADMIN_REPOSITORY')

export interface AdminRepository {
	getStats(dates: {
		startOfToday: Date
		startOfMonth: Date
		startOfLastMonth: Date
	}): Promise<AdminStats>

	findAccounts(
		skip: number,
		limit: number,
		where: Record<string, unknown>,
	): Promise<{ data: AccountListItem[]; total: number }>

	findAccountById(accountId: string): Promise<AccountDetail | null>

	findAccountBasicInfo(
		accountId: string,
		select: Record<string, boolean>,
	): Promise<Record<string, unknown> | null>

	updateAccountPlan(accountId: string, newPlan: PlanType): Promise<AccountBasicInfo>

	createAuditLog(data: {
		action: string
		entity: string
		entity_id: string
		user_id: string
		old_value?: unknown
		new_value?: unknown
		metadata?: unknown
	}): Promise<void>

	cancelActiveSubscriptions(accountId: string): Promise<void>

	updateAccount(
		accountId: string,
		data: Record<string, unknown>,
		select: Record<string, boolean>,
	): Promise<Record<string, unknown>>

	createPasswordResetToken(data: {
		account_id: string
		token: string
		expires_at: Date
	}): Promise<void>

	getAccountUsageCounts(
		accountId: string,
		periodStart: Date,
		periodEnd: Date,
	): Promise<{ products: number; orders: number; customers: number }>

	findActiveUsers(since: Date): Promise<ActiveUser[]>

	getSubscriptionStats(): Promise<SubscriptionStatsResult>

	findAuditLogs(
		skip: number,
		limit: number,
		where: Record<string, unknown>,
	): Promise<{ data: AuditLogEntry[]; total: number }>

	checkDatabaseHealth(): Promise<boolean>
}
