import { Module } from '@nestjs/common'
import { CustomersController } from './controllers/customers.controller'
import { CustomersService } from './services/customers.service'
import { PrismaModule } from '@/shared/prisma/prisma.module'
import { PrismaCustomerRepository } from './repositories/prisma-customer.repository'
import { CUSTOMER_REPOSITORY } from '@/shared/repositories/customer.repository'

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
