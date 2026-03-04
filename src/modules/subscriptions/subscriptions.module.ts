import { Global, Module } from '@nestjs/common'
import { PrismaModule } from '@/shared/prisma/prisma.module'
import { PLAN_LIMITS_REPOSITORY } from '@/shared/repositories/plan-limits.repository'
import { SUBSCRIPTION_REPOSITORY } from '@/shared/repositories/subscription.repository'
import { WEBHOOK_REPOSITORY } from '@/shared/repositories/webhook.repository'
import { SubscriptionController } from './controllers/subscription.controller'
import { WebhookController } from './controllers/webhook.controller'
import { PlanGuard } from './guards/plan.guard'
import { PlanLimitsGuard } from './guards/plan-limits.guard'
import { PrismaPlanLimitsRepository } from './repositories/prisma-plan-limits.repository'
import { PrismaSubscriptionRepository } from './repositories/prisma-subscription.repository'
import { PrismaWebhookRepository } from './repositories/prisma-webhook.repository'
import { PlanLimitsService } from './services/plan-limits.service'
import { StripeService } from './services/stripe.service'
import { SubscriptionService } from './services/subscription.service'
import { WebhookService } from './services/webhook.service'

@Global()
@Module({
	imports: [PrismaModule],
	controllers: [SubscriptionController, WebhookController],
	providers: [
		SubscriptionService,
		PlanGuard,
		PlanLimitsGuard,
		PlanLimitsService,
		WebhookService,
		StripeService,
		{
			provide: SUBSCRIPTION_REPOSITORY,
			useClass: PrismaSubscriptionRepository,
		},
		{
			provide: PLAN_LIMITS_REPOSITORY,
			useClass: PrismaPlanLimitsRepository,
		},
		{
			provide: WEBHOOK_REPOSITORY,
			useClass: PrismaWebhookRepository,
		},
	],
	exports: [SubscriptionService, PlanGuard, PlanLimitsGuard, PlanLimitsService, StripeService],
})
export class SubscriptionsModule {}
