import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import type { PlanType } from '@/generated/prisma/client'
import { ADMIN_REPOSITORY, type AdminRepository } from '@/shared/repositories/admin.repository'

@Injectable()
export class AdminService {
	constructor(@Inject(ADMIN_REPOSITORY) private readonly adminRepository: AdminRepository) {}

	async getStats() {
		const now = new Date()
		const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
		const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
		const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)

		const stats = await this.adminRepository.getStats({
			startOfToday,
			startOfMonth,
			startOfLastMonth,
		})

		const revenueGrowth =
			stats.revenueLastMonth && stats.revenueThisMonth
				? ((stats.revenueThisMonth - stats.revenueLastMonth) / stats.revenueLastMonth) * 100
				: 0

		const ordersGrowth =
			stats.ordersLastMonth > 0
				? ((stats.ordersThisMonth - stats.ordersLastMonth) / stats.ordersLastMonth) * 100
				: 0

		return {
			accounts: {
				total: stats.totalAccounts,
			},
			customers: {
				total: stats.totalCustomers,
			},
			products: {
				total: stats.totalProducts,
				active: stats.activeProducts,
			},
			orders: {
				total: stats.totalOrders,
				today: stats.ordersToday,
				thisMonth: stats.ordersThisMonth,
				pending: stats.pendingOrders,
				growth: Math.round(ordersGrowth * 100) / 100,
			},
			revenue: {
				thisMonth: stats.revenueThisMonth || 0,
				lastMonth: stats.revenueLastMonth || 0,
				growth: Math.round(revenueGrowth * 100) / 100,
			},
		}
	}

	async getAccounts(
		page = 1,
		limit = 20,
		filters?: { role?: string; plan?: string; search?: string },
	) {
		const skip = (page - 1) * limit

		const where: Record<string, unknown> = {}
		if (filters?.role) where.role = filters.role
		if (filters?.plan) where.plan_type = filters.plan
		if (filters?.search) {
			where.OR = [
				{ name: { contains: filters.search, mode: 'insensitive' } },
				{ email: { contains: filters.search, mode: 'insensitive' } },
			]
		}

		const { data: accounts, total } = await this.adminRepository.findAccounts(skip, limit, where)

		return {
			data: accounts,
			meta: {
				total,
				page,
				limit,
				totalPages: Math.ceil(total / limit),
			},
		}
	}

	async getAccountById(accountId: string) {
		const account = await this.adminRepository.findAccountById(accountId)

		if (!account) {
			throw new NotFoundException('Conta não encontrada')
		}

		return account
	}

	async updateAccountPlan(accountId: string, newPlan: PlanType, adminId: string) {
		const account = await this.adminRepository.findAccountBasicInfo(accountId, {
			id: true,
			plan_type: true,
			role: true,
		})

		if (!account) {
			throw new NotFoundException('Conta não encontrada')
		}

		if (account.role === 'admin') {
			throw new BadRequestException('Não é possível alterar o plano de um administrador')
		}

		const oldPlan = account.plan_type

		const updated = await this.adminRepository.updateAccountPlan(accountId, newPlan)

		// Log the action
		await this.adminRepository.createAuditLog({
			action: 'UPDATE_PLAN',
			entity: 'Account',
			entity_id: accountId,
			user_id: adminId,
			old_value: { plan_type: oldPlan },
			new_value: { plan_type: newPlan },
			metadata: { changed_by: 'admin' },
		})

		return updated
	}

	async suspendAccount(accountId: string, reason: string, adminId: string) {
		const account = await this.adminRepository.findAccountBasicInfo(accountId, {
			id: true,
			role: true,
			plan_type: true,
		})

		if (!account) {
			throw new NotFoundException('Conta não encontrada')
		}

		if (account.role === 'admin') {
			throw new BadRequestException('Não é possível suspender um administrador')
		}

		// Cancel any active subscriptions
		await this.adminRepository.cancelActiveSubscriptions(accountId)

		// Downgrade to free (suspended state)
		const updated = await this.adminRepository.updateAccount(
			accountId,
			{ plan_type: 'free' },
			{ id: true, name: true, email: true, plan_type: true },
		)

		await this.adminRepository.createAuditLog({
			action: 'SUSPEND_ACCOUNT',
			entity: 'Account',
			entity_id: accountId,
			user_id: adminId,
			old_value: { plan_type: account.plan_type },
			new_value: { plan_type: 'free', suspended: true },
			metadata: { reason, suspended_by: 'admin' },
		})

		return { ...updated, suspended: true, reason }
	}

	async resetUserPassword(accountId: string, adminId: string) {
		const account = await this.adminRepository.findAccountBasicInfo(accountId, {
			id: true,
			email: true,
			name: true,
		})

		if (!account) {
			throw new NotFoundException('Conta não encontrada')
		}

		// Generate password reset token
		const token = crypto.randomUUID()
		const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours

		await this.adminRepository.createPasswordResetToken({
			account_id: accountId,
			token,
			expires_at: expiresAt,
		})

		await this.adminRepository.createAuditLog({
			action: 'ADMIN_PASSWORD_RESET',
			entity: 'Account',
			entity_id: accountId,
			user_id: adminId,
			metadata: { triggered_by: 'admin' },
		})

		// In production, send email with reset link
		// For now, return token for testing
		return {
			message: 'Token de redefinição de senha gerado',
			email: account.email as string,
			token, // Remove in production - send via email instead
			expiresAt,
		}
	}

	async disable2FA(accountId: string, adminId: string) {
		const account = await this.adminRepository.findAccountBasicInfo(accountId, {
			id: true,
			two_factor_enabled: true,
		})

		if (!account) {
			throw new NotFoundException('Conta não encontrada')
		}

		if (!account.two_factor_enabled) {
			throw new BadRequestException('2FA já está desabilitado para esta conta')
		}

		const updated = await this.adminRepository.updateAccount(
			accountId,
			{
				two_factor_enabled: false,
				two_factor_secret: null,
			},
			{ id: true, name: true, email: true, two_factor_enabled: true },
		)

		await this.adminRepository.createAuditLog({
			action: 'ADMIN_DISABLE_2FA',
			entity: 'Account',
			entity_id: accountId,
			user_id: adminId,
			old_value: { two_factor_enabled: true },
			new_value: { two_factor_enabled: false },
			metadata: { disabled_by: 'admin' },
		})

		return updated
	}

	async getAccountUsage(accountId: string) {
		const account = await this.adminRepository.findAccountBasicInfo(accountId, {
			id: true,
			plan_type: true,
		})

		if (!account) {
			throw new NotFoundException('Conta não encontrada')
		}

		const now = new Date()
		const periodStart = new Date(now.getFullYear(), now.getMonth(), 1)
		const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0)

		const usage = await this.adminRepository.getAccountUsageCounts(
			accountId,
			periodStart,
			periodEnd,
		)

		const limits = {
			free: { products: 50, orders: 30, customers: 100 },
			pro: { products: 500, orders: 500, customers: 1000 },
			enterprise: { products: -1, orders: -1, customers: -1 },
		}

		const planLimits = limits[account.plan_type as string as keyof typeof limits]

		return {
			plan: account.plan_type,
			period: { start: periodStart, end: periodEnd },
			usage: {
				products: { current: usage.products, limit: planLimits.products },
				orders: { current: usage.orders, limit: planLimits.orders },
				customers: { current: usage.customers, limit: planLimits.customers },
			},
		}
	}

	async getActiveUsers() {
		const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000)
		return this.adminRepository.findActiveUsers(thirtyMinutesAgo)
	}

	async getSubscriptionStats() {
		const stats = await this.adminRepository.getSubscriptionStats()

		return {
			byPlan: stats.byPlan.map((p) => ({ plan: p.plan_type, count: p._count.id })),
			recentSubscriptions: stats.recentSubscriptions,
			expiringSubscriptions: stats.expiringSubscriptions,
		}
	}

	async getAuditLogs(page = 1, limit = 50, filters?: { entity?: string; action?: string }) {
		const skip = (page - 1) * limit

		const where: Record<string, unknown> = {}
		if (filters?.entity) where.entity = filters.entity
		if (filters?.action) where.action = filters.action

		const { data: logs, total } = await this.adminRepository.findAuditLogs(skip, limit, where)

		return {
			data: logs,
			meta: {
				total,
				page,
				limit,
				totalPages: Math.ceil(total / limit),
			},
		}
	}

	async getSystemHealth() {
		const dbOk = await this.adminRepository.checkDatabaseHealth()

		return {
			status: 'healthy',
			database: dbOk ? 'connected' : 'disconnected',
			timestamp: new Date().toISOString(),
		}
	}
}
