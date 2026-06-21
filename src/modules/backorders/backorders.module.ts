import { Module } from '@nestjs/common'
import { PrismaModule } from '@/shared/prisma/prisma.module'
import { BACKORDER_REPOSITORY } from '@/shared/repositories/backorder.repository'
import { BackordersController } from './controllers/backorders.controller'
import { PrismaBackorderRepository } from './repositories/prisma-backorder.repository'
import { BackordersService } from './services/backorders.service'

@Module({
	imports: [PrismaModule],
	controllers: [BackordersController],
	providers: [
		BackordersService,
		{
			provide: BACKORDER_REPOSITORY,
			useClass: PrismaBackorderRepository,
		},
	],
	// Exported so ProductsModule + StoreStockModule can enrich their list responses
	// with the owed/pending-orders summary.
	exports: [BACKORDER_REPOSITORY],
})
export class BackordersModule {}
