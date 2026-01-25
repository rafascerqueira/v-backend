import { Injectable } from '@nestjs/common'
import { PrismaService } from '@/shared/prisma/prisma.service'

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async getSalesReport(startDate?: string, endDate?: string) {
    const start = startDate ? new Date(startDate) : new Date(new Date().setMonth(new Date().getMonth() - 1))
    const end = endDate ? new Date(endDate) : new Date()

    const orders = await this.prisma.order.findMany({
      where: {
        createdAt: { gte: start, lte: end },
      },
      include: {
        customer: { select: { name: true } },
        Order_item: true,
      },
      orderBy: { createdAt: 'desc' },
    })

    const totalSales = orders.reduce((acc, o) => acc + o.total, 0)
    const totalOrders = orders.length
    const avgOrderValue = totalOrders > 0 ? totalSales / totalOrders : 0

    const salesByDay = orders.reduce((acc, order) => {
      const day = order.createdAt.toISOString().split('T')[0]
      acc[day] = (acc[day] || 0) + order.total
      return acc
    }, {} as Record<string, number>)

    const salesByStatus = orders.reduce((acc, order) => {
      acc[order.status] = (acc[order.status] || 0) + 1
      return acc
    }, {} as Record<string, number>)

    return {
      summary: {
        totalSales,
        totalOrders,
        avgOrderValue,
        period: { start, end },
      },
      salesByDay: Object.entries(salesByDay).map(([date, value]) => ({ date, value })),
      salesByStatus,
      recentOrders: orders.slice(0, 10).map(o => ({
        id: o.id,
        order_number: o.order_number,
        customer: (o as any).Customer?.name,
        total: o.total,
        status: o.status,
        date: o.createdAt,
      })),
    }
  }

  async getProductsReport(limit = 10) {
    const orderItems = await this.prisma.order_item.groupBy({
      by: ['product_id'],
      _sum: { quantity: true, total: true },
      _count: { id: true },
      orderBy: { _sum: { quantity: 'desc' } },
      take: limit,
    })

    const productIds = orderItems.map(i => i.product_id)
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, name: true, sku: true, category: true },
    })

    const productMap = new Map(products.map(p => [p.id, p]))

    const topProducts = orderItems.map(item => ({
      product: productMap.get(item.product_id),
      quantitySold: item._sum.quantity || 0,
      totalRevenue: item._sum.total || 0,
      orderCount: item._count.id,
    }))

    const salesByCategory = await this.prisma.order_item.findMany({
      include: { product: { select: { category: true } } },
    })

    const categoryTotals = salesByCategory.reduce((acc, item) => {
      const category = (item as any).product?.category || 'Outros'
      acc[category] = (acc[category] || 0) + item.total
      return acc
    }, {} as Record<string, number>)

    return {
      topProducts,
      salesByCategory: Object.entries(categoryTotals)
        .map(([category, value]) => ({ category, value }))
        .sort((a, b) => b.value - a.value),
    }
  }

  async getCustomersReport(limit = 10) {
    const customerOrders = await this.prisma.order.groupBy({
      by: ['customer_id'],
      _sum: { total: true },
      _count: { id: true },
      orderBy: { _sum: { total: 'desc' } },
      take: limit,
    })

    const customerIds = customerOrders.map(c => c.customer_id)
    const customers = await this.prisma.customer.findMany({
      where: { id: { in: customerIds } },
      select: { id: true, name: true, email: true, city: true, state: true },
    })

    const customerMap = new Map(customers.map(c => [c.id, c]))

    const topCustomers = customerOrders.map(item => ({
      customer: customerMap.get(item.customer_id),
      totalSpent: item._sum.total || 0,
      orderCount: item._count.id,
      avgOrderValue: (item._sum.total || 0) / item._count.id,
    }))

    const totalCustomers = await this.prisma.customer.count()
    const activeCustomers = await this.prisma.customer.count({ where: { active: true } })
    const customersWithOrders = customerOrders.length

    return {
      topCustomers,
      summary: {
        totalCustomers,
        activeCustomers,
        customersWithOrders,
        conversionRate: totalCustomers > 0 ? (customersWithOrders / totalCustomers) * 100 : 0,
      },
    }
  }
}
