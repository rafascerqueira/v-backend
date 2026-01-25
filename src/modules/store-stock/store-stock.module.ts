import { Module } from '@nestjs/common'
import { PrismaModule } from '@/shared/prisma/prisma.module'
import { StoreStockController } from './controllers/store-stock.controller'
import { StoreStockService } from './services/store-stock.service'

@Module({
  imports: [PrismaModule],
  controllers: [StoreStockController],
  providers: [StoreStockService],
  exports: [StoreStockService],
})
export class StoreStockModule {}
