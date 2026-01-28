import { Module } from '@nestjs/common'
import { PrismaModule } from '@/shared/prisma/prisma.module'
import { CUSTOMER_REPOSITORY } from '@/shared/repositories/customer.repository'
import { CustomersController } from './controllers/customers.controller'
import { PrismaCustomerRepository } from './repositories/prisma-customer.repository'
import { CustomersService } from './services/customers.service'

@Module({
	imports: [PrismaModule],
	controllers: [CustomersController],
	providers: [
		CustomersService,
		{
			provide: CUSTOMER_REPOSITORY,
			useClass: PrismaCustomerRepository,
		},
	],
	exports: [CustomersService],
})
export class CustomersModule {}
