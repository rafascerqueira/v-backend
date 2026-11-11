import { Injectable } from '@nestjs/common'
import { Prisma } from '@/generated/prisma/client'
import { PrismaService } from '@/shared/prisma/prisma.service'
import type {
	AccountEmailName,
	StripeSubscriptionUpsert,
	SubscriptionRecord,
	SubscriptionRepository,
	UsageRecord,
} from '@/shared/repositories/subscription.repository'
import { AccountSnapshotStore } from '@/shared/session/account-snapshot.store'

@Injectable()
export class PrismaSubscriptionRepository implements SubscriptionRepository {
	constructor(
		private readonly prisma: PrismaService,
		private readonly accountSnapshots: AccountSnapshotStore,
	) {}

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
		// Webhook, reconciliation and cancel all land here: the plan the account's next
		// request sees is the one just written, with no new login.
		await this.accountSnapshots.invalidate(accountId)
	}

	async findActiveSubscription(accountId: string): Promise<SubscriptionRecord | null> {
		return this.prisma.subscription.findFirst({
			where: {
				account_id: accountId,
				// Stripe rows only: a stale legacy PagSeguro row must not keep an account paid.
				payment_provider: 'stripe',
				status: { in: ['active', 'trialing'] },
			},
			orderBy: { createdAt: 'desc' },
		}) as unknown as SubscriptionRecord | null
	}

	async findManageableSubscription(accountId: string): Promise<SubscriptionRecord | null> {
		// Includes past_due (and paused): a seller in dunning must still reach the
		// billing portal to update their card. Only fully canceled subs are excluded.
		// Stripe rows only: a stale legacy PagSeguro row would otherwise block checkout
		// (409) and break the portal (its customer id isn't a Stripe customer).
		return this.prisma.subscription.findFirst({
			where: {
				account_id: accountId,
				payment_provider: 'stripe',
				provider_customer_id: { not: null },
				status: { in: ['active', 'trialing', 'past_due', 'paused'] },
			},
			orderBy: { createdAt: 'desc' },
		}) as unknown as SubscriptionRecord | null
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

	async upsertSubscriptionFromStripe(
		data: StripeSubscriptionUpsert,
	): Promise<'created' | 'updated'> {
		const where = { provider_subscription_id: data.provider_subscription_id }
		// Period/trial are only overwritten when Stripe actually sent them, so a payload
		// missing the item period never clobbers good stored dates with a fallback.
		const updateData = {
			plan_type: data.plan_type as any,
			status: data.status as any,
			provider_customer_id: data.provider_customer_id,
			cancel_at_period_end: data.cancel_at_period_end,
			...(data.current_period_start && { current_period_start: data.current_period_start }),
			...(data.current_period_end && { current_period_end: data.current_period_end }),
			...(data.trial_start !== undefined && { trial_start: data.trial_start }),
			...(data.trial_end !== undefined && { trial_end: data.trial_end }),
		}

		const existing = await this.prisma.subscription.findUnique({ where, select: { id: true } })
		if (existing) {
			await this.prisma.subscription.update({ where, data: updateData })
			return 'updated'
		}

		try {
			await this.prisma.subscription.create({
				data: {
					account_id: data.account_id,
					plan_type: data.plan_type as any,
					status: data.status as any,
					payment_provider: 'stripe',
					provider_subscription_id: data.provider_subscription_id,
					provider_customer_id: data.provider_customer_id,
					// Columns are NOT NULL: fall back only when creating.
					current_period_start: data.current_period_start ?? new Date(),
					current_period_end:
						data.current_period_end ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
					cancel_at_period_end: data.cancel_at_period_end,
					trial_start: data.trial_start ?? null,
					trial_end: data.trial_end ?? null,
				},
			})
			return 'created'
		} catch (err) {
			// Lost a race with a concurrent webhook/reconcile that created the same
			// provider subscription first (unique index): apply ours as an update.
			if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
				await this.prisma.subscription.update({ where, data: updateData })
				return 'updated'
			}
			throw err
		}
	}

	async findPaidAccountIds(planTypes: string[]): Promise<string[]> {
		const rows = await this.prisma.account.findMany({
			where: { plan_type: { in: planTypes as any } },
			select: { id: true },
		})
		return rows.map((row) => row.id)
	}

	async findStripeCustomerId(accountId: string): Promise<string | null> {
		const account = await this.prisma.account.findUnique({
			where: { id: accountId },
			select: { stripe_customer_id: true },
		})
		return account?.stripe_customer_id ?? null
	}

	async setStripeCustomerIdIfMissing(
		accountId: string,
		customerId: string,
	): Promise<string | null> {
		// Conditional write: only the first concurrent request stores its Customer; the
		// re-read returns whichever id won, so every caller converges on the same one.
		await this.prisma.account.updateMany({
			where: { id: accountId, stripe_customer_id: null },
			data: { stripe_customer_id: customerId },
		})
		return this.findStripeCustomerId(accountId)
	}

	async replaceStripeCustomerId(
		accountId: string,
		staleCustomerId: string,
		customerId: string,
	): Promise<string | null> {
		// Compare-and-swap on the stale value: a concurrent replacement wins once.
		await this.prisma.account.updateMany({
			where: { id: accountId, stripe_customer_id: staleCustomerId },
			data: { stripe_customer_id: customerId },
		})
		return this.findStripeCustomerId(accountId)
	}

	async findProviderCustomerIds(accountId: string): Promise<string[]> {
		const rows = await this.prisma.subscription.findMany({
			where: {
				account_id: accountId,
				payment_provider: 'stripe',
				provider_customer_id: { not: null },
			},
			select: { provider_customer_id: true },
			distinct: ['provider_customer_id'],
		})
		return rows.flatMap((row) => (row.provider_customer_id ? [row.provider_customer_id] : []))
	}

	async findPayingProviderSubscriptionIds(accountId: string): Promise<string[]> {
		const rows = await this.prisma.subscription.findMany({
			where: {
				account_id: accountId,
				payment_provider: 'stripe',
				status: { in: ['active', 'trialing'] },
				provider_subscription_id: { not: null },
			},
			select: { provider_subscription_id: true },
		})
		return rows.flatMap((row) =>
			row.provider_subscription_id ? [row.provider_subscription_id] : [],
		)
	}
}
