import { Module } from '@nestjs/common'
import { PrismaModule } from '@/shared/prisma/prisma.module'
import { STORE_STOCK_REPOSITORY } from '@/shared/repositories/store-stock.repository'
import { BackordersModule } from '../backorders/backorders.module'
import { StockMovementsModule } from '../stock-movements/stock-movements.module'
import { StoreStockController } from './controllers/store-stock.controller'
import { PrismaStoreStockRepository } from './repositories/prisma-store-stock.repository'
import { StoreStockService } from './services/store-stock.service'

@Module({
	// StockMovementsModule: a quantity change is recorded as an adjustment movement.
	imports: [PrismaModule, BackordersModule, StockMovementsModule],
	controllers: [StoreStockController],
	providers: [
		StoreStockService,
		{
			provide: STORE_STOCK_REPOSITORY,
			useClass: PrismaStoreStockRepository,
		},
	],
	exports: [StoreStockService],
})
export class StoreStockModule {}
