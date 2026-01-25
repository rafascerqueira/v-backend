import { Module, Global } from '@nestjs/common'
import { PrismaModule } from '@/shared/prisma/prisma.module'
import { SubscriptionService } from './services/subscription.service'
import { SubscriptionController } from './controllers/subscription.controller'
import { PlanGuard } from './guards/plan.guard'
import { WebhookController } from './controllers/webhook.controller'
import { WebhookService } from './services/webhook.service'

@Global()
@Module({
  imports: [PrismaModule],
  controllers: [SubscriptionController, WebhookController],
  providers: [SubscriptionService, PlanGuard, WebhookService],
  exports: [SubscriptionService, PlanGuard],
})
export class SubscriptionsModule {}
