import { Module } from '@nestjs/common'
import { PrismaModule } from '@/shared/prisma/prisma.module'
import { ProductPricesController } from './controllers/product-prices.controller'
import { ProductPricesService } from './services/product-prices.service'

@Module({
	imports: [PrismaModule],
	controllers: [ProductPricesController],
	providers: [ProductPricesService],
	exports: [ProductPricesService],
})
export class ProductPricesModule {}
