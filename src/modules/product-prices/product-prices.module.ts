import { Module } from '@nestjs/common'
import { PrismaModule } from '@/shared/prisma/prisma.module'
import { PRODUCT_PRICE_REPOSITORY } from '@/shared/repositories/product-price.repository'
import { ProductPricesController } from './controllers/product-prices.controller'
import { PrismaProductPriceRepository } from './repositories/prisma-product-price.repository'
import { ProductPricesService } from './services/product-prices.service'

@Module({
	imports: [PrismaModule],
	controllers: [ProductPricesController],
	providers: [
		ProductPricesService,
		{
			provide: PRODUCT_PRICE_REPOSITORY,
			useClass: PrismaProductPriceRepository,
		},
	],
	exports: [ProductPricesService, PRODUCT_PRICE_REPOSITORY],
})
export class ProductPricesModule {}
