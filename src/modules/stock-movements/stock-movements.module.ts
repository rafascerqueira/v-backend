import { Module } from '@nestjs/common'
import { PrismaModule } from '@/shared/prisma/prisma.module'
import { STOCK_MOVEMENT_REPOSITORY } from '@/shared/repositories/stock-movement.repository'
import { StockMovementsController } from './controllers/stock-movements.controller'
import { PrismaStockMovementRepository } from './repositories/prisma-stock-movement.repository'
import { StockMovementsService } from './services/stock-movements.service'

@Module({
	imports: [PrismaModule],
	controllers: [StockMovementsController],
	providers: [
		StockMovementsService,
		{
			provide: STOCK_MOVEMENT_REPOSITORY,
			useClass: PrismaStockMovementRepository,
		},
	],
	exports: [StockMovementsService],
})
export class StockMovementsModule {}
