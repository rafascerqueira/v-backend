import {
	BadRequestException,
	Injectable,
	NotFoundException,
} from "@nestjs/common";
import type { PlanType } from "@/generated/prisma/client";
import { PrismaService } from "@/shared/prisma/prisma.service";

@Injectable()
export class AdminService {
	constructor(private readonly prisma: PrismaService) {}

	async getStats() {
		const now = new Date();
		const startOfToday = new Date(
			now.getFullYear(),
			now.getMonth(),
			now.getDate(),
		);
		const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
		const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);

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
				where: { createdAt: { gte: startOfToday } },
			}),
			this.prisma.order.count({
				where: { createdAt: { gte: startOfMonth } },
			}),
			this.prisma.order.count({
				where: {
					createdAt: { gte: startOfLastMonth, lt: startOfMonth },
				},
			}),
			this.prisma.order.aggregate({
				where: { createdAt: { gte: startOfMonth } },
				_sum: { total: true },
			}),
			this.prisma.order.aggregate({
				where: {
					createdAt: { gte: startOfLastMonth, lt: startOfMonth },
				},
				_sum: { total: true },
			}),
			this.prisma.order.count({
				where: { status: "pending" },
			}),
			this.prisma.product.count({
				where: { active: true, deletedAt: null },
			}),
		]);

		const revenueGrowth =
			revenueLastMonth._sum.total && revenueThisMonth._sum.total
				? ((revenueThisMonth._sum.total - revenueLastMonth._sum.total) /
						revenueLastMonth._sum.total) *
					100
				: 0;

		const ordersGrowth =
			ordersLastMonth > 0
				? ((ordersThisMonth - ordersLastMonth) / ordersLastMonth) * 100
				: 0;

		return {
			accounts: {
				total: totalAccounts,
			},
			customers: {
				total: totalCustomers,
			},
			products: {
				total: totalProducts,
				active: activeProducts,
			},
			orders: {
				total: totalOrders,
				today: ordersToday,
				thisMonth: ordersThisMonth,
				pending: pendingOrders,
				growth: Math.round(ordersGrowth * 100) / 100,
			},
			revenue: {
				thisMonth: revenueThisMonth._sum.total || 0,
				lastMonth: revenueLastMonth._sum.total || 0,
				growth: Math.round(revenueGrowth * 100) / 100,
			},
		};
	}

	async getAccounts(
		page = 1,
		limit = 20,
		filters?: { role?: string; plan?: string; search?: string },
	) {
		const skip = (page - 1) * limit;

		const where: Record<string, unknown> = {};
		if (filters?.role) where.role = filters.role;
		if (filters?.plan) where.plan_type = filters.plan;
		if (filters?.search) {
			where.OR = [
				{ name: { contains: filters.search, mode: "insensitive" } },
				{ email: { contains: filters.search, mode: "insensitive" } },
			];
		}

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
				orderBy: { createdAt: "desc" },
				skip,
				take: limit,
			}),
			this.prisma.account.count({ where }),
		]);

		return {
			data: accounts,
			meta: {
				total,
				page,
				limit,
				totalPages: Math.ceil(total / limit),
			},
		};
	}

	async getAccountById(accountId: string) {
		const account = await this.prisma.account.findUnique({
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
					where: { status: { in: ["active", "trialing"] } },
					orderBy: { createdAt: "desc" },
					take: 1,
				},
				usage_records: {
					orderBy: { period_start: "desc" },
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
		});

		if (!account) {
			throw new NotFoundException("Conta não encontrada");
		}

		return account;
	}

	async updateAccountPlan(
		accountId: string,
		newPlan: PlanType,
		adminId: string,
	) {
		const account = await this.prisma.account.findUnique({
			where: { id: accountId },
			select: { id: true, plan_type: true, role: true },
		});

		if (!account) {
			throw new NotFoundException("Conta não encontrada");
		}

		if (account.role === "admin") {
			throw new BadRequestException(
				"Não é possível alterar o plano de um administrador",
			);
		}

		const oldPlan = account.plan_type;

		const updated = await this.prisma.account.update({
			where: { id: accountId },
			data: { plan_type: newPlan },
			select: {
				id: true,
				name: true,
				email: true,
				plan_type: true,
			},
		});

		// Log the action
		await this.prisma.audit_log.create({
			data: {
				action: "UPDATE_PLAN",
				entity: "Account",
				entity_id: accountId,
				user_id: adminId,
				old_value: { plan_type: oldPlan },
				new_value: { plan_type: newPlan },
				metadata: { changed_by: "admin" },
			},
		});

		return updated;
	}

	async suspendAccount(accountId: string, reason: string, adminId: string) {
		const account = await this.prisma.account.findUnique({
			where: { id: accountId },
			select: { id: true, role: true, plan_type: true },
		});

		if (!account) {
			throw new NotFoundException("Conta não encontrada");
		}

		if (account.role === "admin") {
			throw new BadRequestException(
				"Não é possível suspender um administrador",
			);
		}

		// Cancel any active subscriptions
		await this.prisma.subscription.updateMany({
			where: { account_id: accountId, status: "active" },
			data: { status: "canceled", canceled_at: new Date() },
		});

		// Downgrade to free (suspended state)
		const updated = await this.prisma.account.update({
			where: { id: accountId },
			data: { plan_type: "free" },
			select: { id: true, name: true, email: true, plan_type: true },
		});

		await this.prisma.audit_log.create({
			data: {
				action: "SUSPEND_ACCOUNT",
				entity: "Account",
				entity_id: accountId,
				user_id: adminId,
				old_value: { plan_type: account.plan_type },
				new_value: { plan_type: "free", suspended: true },
				metadata: { reason, suspended_by: "admin" },
			},
		});

		return { ...updated, suspended: true, reason };
	}

	async resetUserPassword(accountId: string, adminId: string) {
		const account = await this.prisma.account.findUnique({
			where: { id: accountId },
			select: { id: true, email: true, name: true },
		});

		if (!account) {
			throw new NotFoundException("Conta não encontrada");
		}

		// Generate password reset token
		const token = crypto.randomUUID();
		const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

		await this.prisma.password_reset_token.create({
			data: {
				account_id: accountId,
				token,
				expires_at: expiresAt,
			},
		});

		await this.prisma.audit_log.create({
			data: {
				action: "ADMIN_PASSWORD_RESET",
				entity: "Account",
				entity_id: accountId,
				user_id: adminId,
				metadata: { triggered_by: "admin" },
			},
		});

		// In production, send email with reset link
		// For now, return token for testing
		return {
			message: "Token de redefinição de senha gerado",
			email: account.email,
			token, // Remove in production - send via email instead
			expiresAt,
		};
	}

	async disable2FA(accountId: string, adminId: string) {
		const account = await this.prisma.account.findUnique({
			where: { id: accountId },
			select: { id: true, two_factor_enabled: true },
		});

		if (!account) {
			throw new NotFoundException("Conta não encontrada");
		}

		if (!account.two_factor_enabled) {
			throw new BadRequestException("2FA já está desabilitado para esta conta");
		}

		const updated = await this.prisma.account.update({
			where: { id: accountId },
			data: {
				two_factor_enabled: false,
				two_factor_secret: null,
			},
			select: { id: true, name: true, email: true, two_factor_enabled: true },
		});

		await this.prisma.audit_log.create({
			data: {
				action: "ADMIN_DISABLE_2FA",
				entity: "Account",
				entity_id: accountId,
				user_id: adminId,
				old_value: { two_factor_enabled: true },
				new_value: { two_factor_enabled: false },
				metadata: { disabled_by: "admin" },
			},
		});

		return updated;
	}

	async getAccountUsage(accountId: string) {
		const account = await this.prisma.account.findUnique({
			where: { id: accountId },
			select: { id: true, plan_type: true },
		});

		if (!account) {
			throw new NotFoundException("Conta não encontrada");
		}

		const now = new Date();
		const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
		const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

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
		]);

		const limits = {
			free: { products: 50, orders: 30, customers: 100 },
			pro: { products: 500, orders: 500, customers: 1000 },
			enterprise: { products: -1, orders: -1, customers: -1 },
		};

		const planLimits = limits[account.plan_type as keyof typeof limits];

		return {
			plan: account.plan_type,
			period: { start: periodStart, end: periodEnd },
			usage: {
				products: { current: products, limit: planLimits.products },
				orders: { current: orders, limit: planLimits.orders },
				customers: { current: customers, limit: planLimits.customers },
			},
		};
	}

	async getActiveUsers() {
		const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);

		const activeUsers = await this.prisma.account.findMany({
			where: {
				last_login_at: { gte: thirtyMinutesAgo },
			},
			select: {
				id: true,
				name: true,
				email: true,
				role: true,
				plan_type: true,
				last_login_at: true,
			},
			orderBy: { last_login_at: "desc" },
		});

		return activeUsers;
	}

	async getSubscriptionStats() {
		const [byPlan, recentSubscriptions, expiringSubscriptions] =
			await Promise.all([
				this.prisma.account.groupBy({
					by: ["plan_type"],
					_count: { id: true },
					where: { role: "seller" },
				}),
				this.prisma.subscription.findMany({
					where: { status: "active" },
					orderBy: { createdAt: "desc" },
					take: 10,
					include: {
						account: {
							select: { name: true, email: true },
						},
					},
				}),
				this.prisma.subscription.findMany({
					where: {
						status: "active",
						current_period_end: {
							lte: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // Next 7 days
							gte: new Date(),
						},
					},
					include: {
						account: {
							select: { name: true, email: true },
						},
					},
				}),
			]);

		return {
			byPlan: byPlan.map((p) => ({ plan: p.plan_type, count: p._count.id })),
			recentSubscriptions,
			expiringSubscriptions,
		};
	}

	async getAuditLogs(
		page = 1,
		limit = 50,
		filters?: { entity?: string; action?: string },
	) {
		const skip = (page - 1) * limit;

		const where: Record<string, unknown> = {};
		if (filters?.entity) where.entity = filters.entity;
		if (filters?.action) where.action = filters.action;

		const [logs, total] = await Promise.all([
			this.prisma.audit_log.findMany({
				where,
				orderBy: { created_at: "desc" },
				skip,
				take: limit,
			}),
			this.prisma.audit_log.count({ where }),
		]);

		return {
			data: logs,
			meta: {
				total,
				page,
				limit,
				totalPages: Math.ceil(total / limit),
			},
		};
	}

	async getSystemHealth() {
		const dbCheck = await this.prisma.$queryRaw`SELECT 1 as ok`;

		return {
			status: "healthy",
			database: dbCheck ? "connected" : "disconnected",
			timestamp: new Date().toISOString(),
		};
	}
}
