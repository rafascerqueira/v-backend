import { Module } from '@nestjs/common'
import { PrismaModule } from '@/shared/prisma/prisma.module'
import { ProductPricesService } from './services/product-prices.service'
import { ProductPricesController } from './controllers/product-prices.controller'

@Module({
  imports: [PrismaModule],
  controllers: [ProductPricesController],
  providers: [ProductPricesService],
  exports: [ProductPricesService],
})
export class ProductPricesModule {}
