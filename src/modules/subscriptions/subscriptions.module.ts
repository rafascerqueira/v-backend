import { BullModule } from '@nestjs/bullmq'
import { Global, Module } from '@nestjs/common'
import { PrismaModule } from '@/shared/prisma/prisma.module'
import { QUEUE_NAMES } from '@/shared/queue/queue.constants'
import { PLAN_LIMITS_REPOSITORY } from '@/shared/repositories/plan-limits.repository'
import { SUBSCRIPTION_REPOSITORY } from '@/shared/repositories/subscription.repository'
import { WEBHOOK_REPOSITORY } from '@/shared/repositories/webhook.repository'
import { AdminSubscriptionController } from './controllers/admin-subscription.controller'
import { SubscriptionController } from './controllers/subscription.controller'
import { WebhookController } from './controllers/webhook.controller'
import { FeatureGuard } from './guards/feature.guard'
import { PlanLimitsGuard } from './guards/plan-limits.guard'
import { SubscriptionReconcileProcessor } from './processors/subscription-reconcile.processor'
import { PrismaPlanLimitsRepository } from './repositories/prisma-plan-limits.repository'
import { PrismaSubscriptionRepository } from './repositories/prisma-subscription.repository'
import { PrismaWebhookRepository } from './repositories/prisma-webhook.repository'
import { PlanLimitsService } from './services/plan-limits.service'
import { StripeService } from './services/stripe.service'
import { SubscriptionService } from './services/subscription.service'
import { SubscriptionReconcileService } from './services/subscription-reconcile.service'
import { WebhookService } from './services/webhook.service'

@Global()
@Module({
	imports: [PrismaModule, BullModule.registerQueue({ name: QUEUE_NAMES.SUBSCRIPTION })],
	controllers: [SubscriptionController, WebhookController, AdminSubscriptionController],
	providers: [
		SubscriptionService,
		PlanLimitsGuard,
		FeatureGuard,
		PlanLimitsService,
		WebhookService,
		StripeService,
		SubscriptionReconcileService,
		SubscriptionReconcileProcessor,
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
	exports: [
		SubscriptionService,
		PlanLimitsGuard,
		FeatureGuard,
		PlanLimitsService,
		StripeService,
		SubscriptionReconcileService,
	],
})
export class SubscriptionsModule {}
