import { Module } from '@nestjs/common'
import { PrismaModule } from '@/shared/prisma/prisma.module'
import { BILLING_REPOSITORY } from '@/shared/repositories/billing.repository'
import { ORDER_REPOSITORY } from '@/shared/repositories/order.repository'
import { TenantModule } from '@/shared/tenant/tenant.module'
import { PrismaBillingRepository } from '../billings/repositories/prisma-billing.repository'
import { CustomersModule } from '../customers/customers.module'
import { OrdersController } from './controllers/orders.controller'
import { PrismaOrderRepository } from './repositories/prisma-order.repository'
import { OrdersService } from './services/orders.service'

@Module({
	imports: [PrismaModule, TenantModule, CustomersModule],
	controllers: [OrdersController],
	providers: [
		OrdersService,
		{
			provide: ORDER_REPOSITORY,
			useClass: PrismaOrderRepository,
		},
		{
			provide: BILLING_REPOSITORY,
			useClass: PrismaBillingRepository,
		},
	],
	exports: [OrdersService],
})
export class OrdersModule {}
