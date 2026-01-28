import { Module } from '@nestjs/common'
import { PrismaModule } from '@/shared/prisma/prisma.module'
import { StockMovementsController } from './controllers/stock-movements.controller'
import { StockMovementsService } from './services/stock-movements.service'

@Module({
	imports: [PrismaModule],
	controllers: [StockMovementsController],
	providers: [StockMovementsService],
	exports: [StockMovementsService],
})
export class StockMovementsModule {}
