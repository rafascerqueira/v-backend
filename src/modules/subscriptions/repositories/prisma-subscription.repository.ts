import { Injectable } from '@nestjs/common'
import { PrismaService } from '@/shared/prisma/prisma.service'
import type {
	AccountEmailName,
	SubscriptionRecord,
	SubscriptionRepository,
	UsageRecord,
} from '@/shared/repositories/subscription.repository'

@Injectable()
export class PrismaSubscriptionRepository implements SubscriptionRepository {
	constructor(private readonly prisma: PrismaService) {}

	async findAccountPlan(accountId: string): Promise<string | null> {
		const account = await this.prisma.account.findUnique({
			where: { id: accountId },
			select: { plan_type: true },
		})
		return account?.plan_type ?? null
	}

	async updateAccountPlan(accountId: string, planType: string): Promise<void> {
		await this.prisma.account.update({
			where: { id: accountId },
			data: { plan_type: planType as any },
		})
	}

	async findActiveSubscription(accountId: string): Promise<SubscriptionRecord | null> {
		return this.prisma.subscription.findFirst({
			where: {
				account_id: accountId,
				status: { in: ['active', 'trialing'] },
			},
			orderBy: { createdAt: 'desc' },
		}) as unknown as SubscriptionRecord | null
	}

	async findManageableSubscription(accountId: string): Promise<SubscriptionRecord | null> {
		// Includes past_due (and paused): a seller in dunning must still reach the
		// billing portal to update their card. Only fully canceled subs are excluded.
		return this.prisma.subscription.findFirst({
			where: {
				account_id: accountId,
				provider_customer_id: { not: null },
				status: { in: ['active', 'trialing', 'past_due', 'paused'] },
			},
			orderBy: { createdAt: 'desc' },
		}) as unknown as SubscriptionRecord | null
	}

	async createSubscription(data: {
		account_id: string
		plan_type: string
		status: string
		payment_provider: string
		provider_subscription_id: string
		provider_customer_id: string
		current_period_start: Date
		current_period_end: Date
		trial_start: Date | null
		trial_end: Date | null
	}): Promise<SubscriptionRecord> {
		return this.prisma.subscription.create({
			data: data as any,
		}) as unknown as SubscriptionRecord
	}

	async findUsageRecord(accountId: string, periodStart: Date): Promise<UsageRecord | null> {
		return this.prisma.usage_record.findUnique({
			where: {
				account_id_period_start: {
					account_id: accountId,
					period_start: periodStart,
				},
			},
		}) as unknown as UsageRecord | null
	}

	async createUsageRecord(data: {
		account_id: string
		period_start: Date
		period_end: Date
		products_count: number
		orders_count: number
		customers_count: number
	}): Promise<UsageRecord> {
		return this.prisma.usage_record.create({
			data,
		}) as unknown as UsageRecord
	}

	async upsertUsageRecord(
		accountId: string,
		periodStart: Date,
		data: {
			period_end: Date
			products_count: number
			orders_count: number
			customers_count: number
		},
	): Promise<UsageRecord> {
		return this.prisma.usage_record.upsert({
			where: {
				account_id_period_start: {
					account_id: accountId,
					period_start: periodStart,
				},
			},
			update: {
				products_count: data.products_count,
				orders_count: data.orders_count,
				customers_count: data.customers_count,
				period_end: data.period_end,
			},
			create: {
				account_id: accountId,
				period_start: periodStart,
				period_end: data.period_end,
				products_count: data.products_count,
				orders_count: data.orders_count,
				customers_count: data.customers_count,
			},
		}) as unknown as UsageRecord
	}

	async countResources(
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

	async findAccountEmailName(accountId: string): Promise<AccountEmailName | null> {
		return this.prisma.account.findUnique({
			where: { id: accountId },
			select: { email: true, name: true },
		})
	}

	async updateSubscriptionsByProviderId(
		providerSubscriptionId: string,
		data: Record<string, unknown>,
	): Promise<void> {
		await this.prisma.subscription.updateMany({
			where: { provider_subscription_id: providerSubscriptionId },
			data: data as any,
		})
	}

	async upsertSubscriptionFromStripe(data: {
		account_id: string
		plan_type: string
		status: string
		provider_subscription_id: string
		provider_customer_id: string | null
		current_period_start: Date
		current_period_end: Date
		cancel_at_period_end: boolean
	}): Promise<'created' | 'updated'> {
		const existing = await this.prisma.subscription.findFirst({
			where: { provider_subscription_id: data.provider_subscription_id },
			select: { id: true },
		})

		if (existing) {
			await this.prisma.subscription.update({
				where: { id: existing.id },
				data: {
					plan_type: data.plan_type as any,
					status: data.status as any,
					provider_customer_id: data.provider_customer_id,
					current_period_start: data.current_period_start,
					current_period_end: data.current_period_end,
					cancel_at_period_end: data.cancel_at_period_end,
				},
			})
			return 'updated'
		}

		await this.prisma.subscription.create({
			data: {
				account_id: data.account_id,
				plan_type: data.plan_type as any,
				status: data.status as any,
				payment_provider: 'stripe',
				provider_subscription_id: data.provider_subscription_id,
				provider_customer_id: data.provider_customer_id,
				current_period_start: data.current_period_start,
				current_period_end: data.current_period_end,
				cancel_at_period_end: data.cancel_at_period_end,
			},
		})
		return 'created'
	}

	async findPaidAccountIds(planTypes: string[]): Promise<string[]> {
		const rows = await this.prisma.account.findMany({
			where: { plan_type: { in: planTypes as any } },
			select: { id: true },
		})
		return rows.map((row) => row.id)
	}
}
