import { Module } from '@nestjs/common'
import { PrismaModule } from '@/shared/prisma/prisma.module'
import { BILLING_REPOSITORY } from '@/shared/repositories/billing.repository'
import { BILLING_PAYMENT_REPOSITORY } from '@/shared/repositories/billing-payment.repository'
import { TenantModule } from '@/shared/tenant/tenant.module'
import { BillingsController } from './controllers/billings.controller'
import { PrismaBillingRepository } from './repositories/prisma-billing.repository'
import { PrismaBillingPaymentRepository } from './repositories/prisma-billing-payment.repository'
import { BillingsService } from './services/billings.service'

@Module({
	imports: [PrismaModule, TenantModule],
	controllers: [BillingsController],
	providers: [
		BillingsService,
		{
			provide: BILLING_REPOSITORY,
			useClass: PrismaBillingRepository,
		},
		{
			provide: BILLING_PAYMENT_REPOSITORY,
			useClass: PrismaBillingPaymentRepository,
		},
	],
	exports: [BillingsService],
})
export class BillingsModule {}
