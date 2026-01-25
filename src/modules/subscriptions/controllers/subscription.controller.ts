import { Controller, Get, Post, Body, Req } from '@nestjs/common'
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { SubscriptionService } from '../services/subscription.service'
import { PLAN_LIMITS, PLAN_PRICES, PLAN_NAMES } from '../constants/plan-limits'

@ApiTags('subscriptions')
@Controller('subscriptions')
export class SubscriptionController {
  constructor(private readonly service: SubscriptionService) {}

  @Get('info')
  @ApiOperation({ summary: 'Get current subscription info and usage' })
  @ApiResponse({ status: 200, description: 'Subscription info retrieved' })
  async getSubscriptionInfo(@Req() req: any) {
    const userId = req.user.sub
    return this.service.getSubscriptionInfo(userId)
  }

  @Get('plans')
  @ApiOperation({ summary: 'Get available plans and pricing' })
  @ApiResponse({ status: 200, description: 'Plans retrieved' })
  async getPlans() {
    return {
      plans: Object.entries(PLAN_LIMITS).map(([key, limits]) => ({
        id: key,
        name: PLAN_NAMES[key as keyof typeof PLAN_NAMES],
        price: PLAN_PRICES[key as keyof typeof PLAN_PRICES],
        limits: {
          maxProducts: limits.maxProducts,
          maxOrdersPerMonth: limits.maxOrdersPerMonth,
          maxCustomers: limits.maxCustomers,
        },
        features: limits.features,
      })),
    }
  }

  @Get('usage')
  @ApiOperation({ summary: 'Get current usage statistics' })
  @ApiResponse({ status: 200, description: 'Usage retrieved' })
  async getUsage(@Req() req: any) {
    const userId = req.user.sub
    return this.service.getCurrentUsage(userId)
  }

  @Post('refresh-usage')
  @ApiOperation({ summary: 'Refresh usage statistics' })
  @ApiResponse({ status: 200, description: 'Usage refreshed' })
  async refreshUsage(@Req() req: any) {
    const userId = req.user.sub
    return this.service.refreshUsage(userId)
  }

  @Get('check-limit/products')
  @ApiOperation({ summary: 'Check products limit' })
  async checkProductsLimit(@Req() req: any) {
    return this.service.checkLimit(req.user.sub, 'products')
  }

  @Get('check-limit/orders')
  @ApiOperation({ summary: 'Check orders limit' })
  async checkOrdersLimit(@Req() req: any) {
    return this.service.checkLimit(req.user.sub, 'orders')
  }

  @Get('check-limit/customers')
  @ApiOperation({ summary: 'Check customers limit' })
  async checkCustomersLimit(@Req() req: any) {
    return this.service.checkLimit(req.user.sub, 'customers')
  }
}
