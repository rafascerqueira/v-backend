import { Global, Module } from "@nestjs/common";
import { PrismaModule } from "@/shared/prisma/prisma.module";
import { SubscriptionController } from "./controllers/subscription.controller";
import { WebhookController } from "./controllers/webhook.controller";
import { PlanGuard } from "./guards/plan.guard";
import { PlanLimitsGuard } from "./guards/plan-limits.guard";
import { PlanLimitsService } from "./services/plan-limits.service";
import { StripeService } from "./services/stripe.service";
import { SubscriptionService } from "./services/subscription.service";
import { WebhookService } from "./services/webhook.service";

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
	],
	exports: [
		SubscriptionService,
		PlanGuard,
		PlanLimitsGuard,
		PlanLimitsService,
		StripeService,
	],
})
export class SubscriptionsModule {}
