import { Module } from '@nestjs/common'
import { PrismaModule } from '@/shared/prisma/prisma.module'
import { STORE_STOCK_REPOSITORY } from '@/shared/repositories/store-stock.repository'
import { StoreStockController } from './controllers/store-stock.controller'
import { PrismaStoreStockRepository } from './repositories/prisma-store-stock.repository'
import { StoreStockService } from './services/store-stock.service'

@Module({
	imports: [PrismaModule],
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
