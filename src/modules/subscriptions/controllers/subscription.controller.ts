import {
	BadRequestException,
	Body,
	Controller,
	Get,
	InternalServerErrorException,
	Post,
	Req,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { PLAN_LIMITS, PLAN_NAMES, PLAN_PRICES } from '../constants/plan-limits'
import { StripeService } from '../services/stripe.service'
import { SubscriptionService } from '../services/subscription.service'

@ApiTags('subscriptions')
@Controller('subscriptions')
export class SubscriptionController {
	constructor(
		private readonly service: SubscriptionService,
		private readonly stripeService: StripeService,
		private readonly configService: ConfigService,
	) {}

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

	@Post('checkout')
	@ApiOperation({ summary: 'Create a Stripe Checkout session for plan upgrade' })
	@ApiResponse({ status: 201, description: 'Checkout URL returned' })
	async createCheckout(@Req() req: any, @Body() body: { planId: string }) {
		const accountId = req.user.sub

		const priceId = this.configService.get<string>(`stripe.priceIds.${body.planId}`)
		if (!priceId) {
			throw new BadRequestException('Plano inválido ou pagamento não configurado')
		}

		const frontendUrl = this.configService.get<string>('frontendUrl')
		const result = await this.stripeService.createCheckoutSession(
			accountId,
			priceId,
			`${frontendUrl}/plans?checkout=success`,
			`${frontendUrl}/plans?checkout=canceled`,
		)

		if (!result?.url) {
			throw new InternalServerErrorException('Falha ao criar sessão de pagamento')
		}

		return { url: result.url }
	}

	@Post('portal')
	@ApiOperation({ summary: 'Create a Stripe Billing Portal session to manage subscription' })
	@ApiResponse({ status: 201, description: 'Portal URL returned' })
	async createPortal(@Req() req: any) {
		const accountId = req.user.sub

		const subscription = await this.service.getActiveSubscription(accountId)
		if (!subscription?.provider_customer_id) {
			throw new BadRequestException('Nenhuma assinatura ativa encontrada')
		}

		const frontendUrl = this.configService.get<string>('frontendUrl')
		const url = await this.stripeService.createPortalSession(
			subscription.provider_customer_id,
			`${frontendUrl}/plans`,
		)

		if (!url) {
			throw new InternalServerErrorException('Falha ao criar sessão do portal de pagamentos')
		}

		return { url }
	}
}
