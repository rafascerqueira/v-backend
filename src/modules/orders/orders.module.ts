import { Module } from '@nestjs/common'
import { PrismaModule } from '@/shared/prisma/prisma.module'
import { ORDER_REPOSITORY } from '@/shared/repositories/order.repository'
import { TenantModule } from '@/shared/tenant/tenant.module'
import { CustomersModule } from '../customers/customers.module'
import { OrdersController } from './controllers/orders.controller'
import { OrderNotificationsHandler } from './handlers/order-notifications.handler'
import { PrismaOrderRepository } from './repositories/prisma-order.repository'
import { OrdersService } from './services/orders.service'

@Module({
	imports: [PrismaModule, TenantModule, CustomersModule],
	controllers: [OrdersController],
	providers: [
		OrdersService,
		OrderNotificationsHandler,
		{
			provide: ORDER_REPOSITORY,
			useClass: PrismaOrderRepository,
		},
	],
	exports: [OrdersService],
})
export class OrdersModule {}
