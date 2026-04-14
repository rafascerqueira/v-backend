import { Module } from '@nestjs/common'
import { PrismaModule } from '@/shared/prisma/prisma.module'
import { BILLING_REPOSITORY } from '@/shared/repositories/billing.repository'
import { TenantModule } from '@/shared/tenant/tenant.module'
import { BillingsController } from './controllers/billings.controller'
import { PrismaBillingRepository } from './repositories/prisma-billing.repository'
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
	],
	exports: [BillingsService],
})
export class BillingsModule {}
