import { Injectable } from '@nestjs/common'
import type { PlanType } from '@/generated/prisma/client'
import { PrismaService } from '@/shared/prisma/prisma.service'
import type {
	AccountBasicInfo,
	AccountDetail,
	AccountListItem,
	ActiveUser,
	AdminRepository,
	AdminStats,
	AuditLogEntry,
	SubscriptionStatsResult,
} from '@/shared/repositories/admin.repository'

@Injectable()
export class PrismaAdminRepository implements AdminRepository {
	constructor(private readonly prisma: PrismaService) {}

	async getStats(dates: {
		startOfToday: Date
		startOfMonth: Date
		startOfLastMonth: Date
	}): Promise<AdminStats> {
		const [
			totalAccounts,
			totalCustomers,
			totalProducts,
			totalOrders,
			ordersToday,
			ordersThisMonth,
			ordersLastMonth,
			revenueThisMonth,
			revenueLastMonth,
			pendingOrders,
			activeProducts,
		] = await Promise.all([
			this.prisma.account.count(),
			this.prisma.customer.count(),
			this.prisma.product.count(),
			this.prisma.order.count(),
			this.prisma.order.count({
				where: { createdAt: { gte: dates.startOfToday } },
			}),
			this.prisma.order.count({
				where: { createdAt: { gte: dates.startOfMonth } },
			}),
			this.prisma.order.count({
				where: {
					createdAt: { gte: dates.startOfLastMonth, lt: dates.startOfMonth },
				},
			}),
			this.prisma.order.aggregate({
				where: { createdAt: { gte: dates.startOfMonth } },
				_sum: { total: true },
			}),
			this.prisma.order.aggregate({
				where: {
					createdAt: { gte: dates.startOfLastMonth, lt: dates.startOfMonth },
				},
				_sum: { total: true },
			}),
			this.prisma.order.count({
				where: { status: 'pending' },
			}),
			this.prisma.product.count({
				where: { active: true, deletedAt: null },
			}),
		])

		return {
			totalAccounts,
			totalCustomers,
			totalProducts,
			totalOrders,
			ordersToday,
			ordersThisMonth,
			ordersLastMonth,
			revenueThisMonth: revenueThisMonth._sum.total,
			revenueLastMonth: revenueLastMonth._sum.total,
			pendingOrders,
			activeProducts,
		}
	}

	async findAccounts(
		skip: number,
		limit: number,
		where: Record<string, unknown>,
	): Promise<{ data: AccountListItem[]; total: number }> {
		const [accounts, total] = await Promise.all([
			this.prisma.account.findMany({
				where,
				select: {
					id: true,
					name: true,
					email: true,
					role: true,
					plan_type: true,
					two_factor_enabled: true,
					last_login_at: true,
					createdAt: true,
					updatedAt: true,
					_count: {
						select: {
							products: true,
							customers: true,
							orders: true,
						},
					},
				},
				orderBy: { createdAt: 'desc' },
				skip,
				take: limit,
			}),
			this.prisma.account.count({ where }),
		])

		return { data: accounts as unknown as AccountListItem[], total }
	}

	async findAccountById(accountId: string): Promise<AccountDetail | null> {
		return this.prisma.account.findUnique({
			where: { id: accountId },
			select: {
				id: true,
				name: true,
				email: true,
				role: true,
				plan_type: true,
				two_factor_enabled: true,
				last_login_at: true,
				createdAt: true,
				updatedAt: true,
				subscriptions: {
					where: { status: { in: ['active', 'trialing'] } },
					orderBy: { createdAt: 'desc' },
					take: 1,
				},
				usage_records: {
					orderBy: { period_start: 'desc' },
					take: 1,
				},
				_count: {
					select: {
						products: true,
						customers: true,
						orders: true,
					},
				},
			},
		}) as unknown as AccountDetail | null
	}

	async findAccountBasicInfo(
		accountId: string,
		select: Record<string, boolean>,
	): Promise<Record<string, unknown> | null> {
		return this.prisma.account.findUnique({
			where: { id: accountId },
			select,
		}) as unknown as Record<string, unknown> | null
	}

	async updateAccountPlan(accountId: string, newPlan: PlanType): Promise<AccountBasicInfo> {
		return this.prisma.account.update({
			where: { id: accountId },
			data: { plan_type: newPlan },
			select: {
				id: true,
				name: true,
				email: true,
				plan_type: true,
			},
		}) as unknown as AccountBasicInfo
	}

	async createAuditLog(data: {
		action: string
		entity: string
		entity_id: string
		user_id: string
		old_value?: unknown
		new_value?: unknown
		metadata?: unknown
	}): Promise<void> {
		await this.prisma.audit_log.create({
			data: {
				action: data.action,
				entity: data.entity,
				entity_id: data.entity_id,
				user_id: data.user_id,
				old_value: data.old_value as any,
				new_value: data.new_value as any,
				metadata: data.metadata as any,
			},
		})
	}

	async cancelActiveSubscriptions(accountId: string): Promise<void> {
		await this.prisma.subscription.updateMany({
			where: { account_id: accountId, status: 'active' },
			data: { status: 'canceled', canceled_at: new Date() },
		})
	}

	async updateAccount(
		accountId: string,
		data: Record<string, unknown>,
		select: Record<string, boolean>,
	): Promise<Record<string, unknown>> {
		return this.prisma.account.update({
			where: { id: accountId },
			data: data as any,
			select,
		}) as unknown as Record<string, unknown>
	}

	async createPasswordResetToken(data: {
		account_id: string
		token: string
		expires_at: Date
	}): Promise<void> {
		await this.prisma.password_reset_token.create({
			data: {
				account_id: data.account_id,
				token: data.token,
				expires_at: data.expires_at,
			},
		})
	}

	async getAccountUsageCounts(
		accountId: string,
		periodStart: Date,
		periodEnd: Date,
	): Promise<{ products: number; orders: number; customers: number }> {
		const [products, orders, customers] = await Promise.all([
			this.prisma.product.count({
				where: { seller_id: accountId, deletedAt: null },
			}),
			this.prisma.order.count({
				where: {
					seller_id: accountId,
					createdAt: { gte: periodStart, lte: periodEnd },
				},
			}),
			this.prisma.customer.count({
				where: { seller_id: accountId, active: true },
			}),
		])

		return { products, orders, customers }
	}

	async findActiveUsers(since: Date): Promise<ActiveUser[]> {
		return this.prisma.account.findMany({
			where: {
				last_login_at: { gte: since },
			},
			select: {
				id: true,
				name: true,
				email: true,
				role: true,
				plan_type: true,
				last_login_at: true,
			},
			orderBy: { last_login_at: 'desc' },
		}) as unknown as ActiveUser[]
	}

	async getSubscriptionStats(): Promise<SubscriptionStatsResult> {
		const [byPlan, recentSubscriptions, expiringSubscriptions] = await Promise.all([
			this.prisma.account.groupBy({
				by: ['plan_type'],
				_count: { id: true },
				where: { role: 'seller' },
			}),
			this.prisma.subscription.findMany({
				where: { status: 'active' },
				orderBy: { createdAt: 'desc' },
				take: 10,
				include: {
					account: {
						select: { name: true, email: true },
					},
				},
			}),
			this.prisma.subscription.findMany({
				where: {
					status: 'active',
					current_period_end: {
						lte: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
						gte: new Date(),
					},
				},
				include: {
					account: {
						select: { name: true, email: true },
					},
				},
			}),
		])

		return {
			byPlan: byPlan as unknown as SubscriptionStatsResult['byPlan'],
			recentSubscriptions,
			expiringSubscriptions,
		}
	}

	async findAuditLogs(
		skip: number,
		limit: number,
		where: Record<string, unknown>,
	): Promise<{ data: AuditLogEntry[]; total: number }> {
		const [logs, total] = await Promise.all([
			this.prisma.audit_log.findMany({
				where,
				orderBy: { created_at: 'desc' },
				skip,
				take: limit,
			}),
			this.prisma.audit_log.count({ where }),
		])

		return { data: logs as unknown as AuditLogEntry[], total }
	}

	async checkDatabaseHealth(): Promise<boolean> {
		try {
			await this.prisma.$queryRaw`SELECT 1 as ok`
			return true
		} catch {
			return false
		}
	}
}
