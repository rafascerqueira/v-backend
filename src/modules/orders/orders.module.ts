import { Module } from '@nestjs/common'
import { PrismaModule } from '@/shared/prisma/prisma.module'
import { ORDER_REPOSITORY } from '@/shared/repositories/order.repository'
import { OrdersController } from './controllers/orders.controller'
import { PrismaOrderRepository } from './repositories/prisma-order.repository'
import { OrdersService } from './services/orders.service'

@Module({
	imports: [PrismaModule],
	controllers: [OrdersController],
	providers: [
		OrdersService,
		{
			provide: ORDER_REPOSITORY,
			useClass: PrismaOrderRepository,
		},
	],
	exports: [OrdersService],
})
export class OrdersModule {}
