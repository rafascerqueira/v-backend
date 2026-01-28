import { Global, Module } from '@nestjs/common'
import { PrismaModule } from '@/shared/prisma/prisma.module'
import { SubscriptionController } from './controllers/subscription.controller'
import { WebhookController } from './controllers/webhook.controller'
import { PlanGuard } from './guards/plan.guard'
import { SubscriptionService } from './services/subscription.service'
import { WebhookService } from './services/webhook.service'

@Global()
@Module({
	imports: [PrismaModule],
	controllers: [SubscriptionController, WebhookController],
	providers: [SubscriptionService, PlanGuard, WebhookService],
	exports: [SubscriptionService, PlanGuard],
})
export class SubscriptionsModule {}
