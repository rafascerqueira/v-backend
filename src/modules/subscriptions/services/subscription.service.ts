import { Injectable } from '@nestjs/common'
import { PrismaService } from '@/shared/prisma/prisma.service'
import { PLAN_LIMITS, type PlanType, type PlanFeatures } from '../constants/plan-limits'

@Injectable()
export class SubscriptionService {
  constructor(private readonly prisma: PrismaService) {}

  async getAccountPlan(accountId: string): Promise<PlanType> {
    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
      select: { plan_type: true },
    })
    return (account?.plan_type as PlanType) || 'free'
  }

  async getActiveSubscription(accountId: string) {
    return this.prisma.subscription.findFirst({
      where: {
        account_id: accountId,
        status: { in: ['active', 'trialing'] },
      },
      orderBy: { createdAt: 'desc' },
    })
  }

  async getCurrentUsage(accountId: string) {
    const now = new Date()
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59)

    let usageRecord = await this.prisma.usage_record.findUnique({
      where: {
        account_id_period_start: {
          account_id: accountId,
          period_start: periodStart,
        },
      },
    })

    if (!usageRecord) {
      // Calculate current usage
      const [productsCount, ordersCount, customersCount] = await Promise.all([
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

      usageRecord = await this.prisma.usage_record.create({
        data: {
          account_id: accountId,
          period_start: periodStart,
          period_end: periodEnd,
          products_count: productsCount,
          orders_count: ordersCount,
          customers_count: customersCount,
        },
      })
    }

    return usageRecord
  }

  async refreshUsage(accountId: string) {
    const now = new Date()
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59)

    const [productsCount, ordersCount, customersCount] = await Promise.all([
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

    return this.prisma.usage_record.upsert({
      where: {
        account_id_period_start: {
          account_id: accountId,
          period_start: periodStart,
        },
      },
      update: {
        products_count: productsCount,
        orders_count: ordersCount,
        customers_count: customersCount,
        period_end: periodEnd,
      },
      create: {
        account_id: accountId,
        period_start: periodStart,
        period_end: periodEnd,
        products_count: productsCount,
        orders_count: ordersCount,
        customers_count: customersCount,
      },
    })
  }

  async checkLimit(
    accountId: string,
    limitType: 'products' | 'orders' | 'customers',
  ): Promise<{ allowed: boolean; current: number; limit: number; remaining: number }> {
    const plan = await this.getAccountPlan(accountId)
    const limits = PLAN_LIMITS[plan]
    const usage = await this.getCurrentUsage(accountId)

    let current: number
    let limit: number

    switch (limitType) {
      case 'products':
        current = usage.products_count
        limit = limits.maxProducts
        break
      case 'orders':
        current = usage.orders_count
        limit = limits.maxOrdersPerMonth
        break
      case 'customers':
        current = usage.customers_count
        limit = limits.maxCustomers
        break
    }

    // -1 means unlimited
    if (limit === -1) {
      return { allowed: true, current, limit: -1, remaining: -1 }
    }

    const remaining = Math.max(0, limit - current)
    const allowed = current < limit

    return { allowed, current, limit, remaining }
  }

  async hasFeature(accountId: string, feature: PlanFeatures): Promise<boolean> {
    const plan = await this.getAccountPlan(accountId)
    return PLAN_LIMITS[plan].features[feature]
  }

  async getSubscriptionInfo(accountId: string) {
    const [plan, subscription, usage] = await Promise.all([
      this.getAccountPlan(accountId),
      this.getActiveSubscription(accountId),
      this.getCurrentUsage(accountId),
    ])

    const limits = PLAN_LIMITS[plan]

    return {
      plan,
      subscription,
      usage: {
        products: {
          current: usage.products_count,
          limit: limits.maxProducts,
          percentage: limits.maxProducts === -1 ? 0 : Math.round((usage.products_count / limits.maxProducts) * 100),
        },
        orders: {
          current: usage.orders_count,
          limit: limits.maxOrdersPerMonth,
          percentage: limits.maxOrdersPerMonth === -1 ? 0 : Math.round((usage.orders_count / limits.maxOrdersPerMonth) * 100),
        },
        customers: {
          current: usage.customers_count,
          limit: limits.maxCustomers,
          percentage: limits.maxCustomers === -1 ? 0 : Math.round((usage.customers_count / limits.maxCustomers) * 100),
        },
      },
      features: limits.features,
      periodStart: usage.period_start,
      periodEnd: usage.period_end,
    }
  }

  async updatePlan(accountId: string, newPlan: PlanType) {
    return this.prisma.account.update({
      where: { id: accountId },
      data: { plan_type: newPlan },
    })
  }

  async createSubscription(data: {
    accountId: string
    planType: PlanType
    paymentProvider: string
    providerSubscriptionId: string
    providerCustomerId: string
    periodStart: Date
    periodEnd: Date
    trialEnd?: Date
  }) {
    const subscription = await this.prisma.subscription.create({
      data: {
        account_id: data.accountId,
        plan_type: data.planType,
        status: data.trialEnd ? 'trialing' : 'active',
        payment_provider: data.paymentProvider,
        provider_subscription_id: data.providerSubscriptionId,
        provider_customer_id: data.providerCustomerId,
        current_period_start: data.periodStart,
        current_period_end: data.periodEnd,
        trial_start: data.trialEnd ? new Date() : null,
        trial_end: data.trialEnd,
      },
    })

    // Update account plan
    await this.updatePlan(data.accountId, data.planType)

    return subscription
  }

  async cancelSubscription(subscriptionId: number, cancelAtPeriodEnd = true) {
    return this.prisma.subscription.update({
      where: { id: subscriptionId },
      data: {
        cancel_at_period_end: cancelAtPeriodEnd,
        canceled_at: cancelAtPeriodEnd ? null : new Date(),
        status: cancelAtPeriodEnd ? 'active' : 'canceled',
      },
    })
  }

  async handleSubscriptionEnded(accountId: string) {
    // Downgrade to free plan
    await this.updatePlan(accountId, 'free')
  }
}
