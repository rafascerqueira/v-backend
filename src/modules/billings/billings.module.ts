import { Module } from '@nestjs/common'
import { PrismaModule } from '@/shared/prisma/prisma.module'
import { BillingsController } from './controllers/billings.controller'
import { BillingsService } from './services/billings.service'

@Module({
	imports: [PrismaModule],
	controllers: [BillingsController],
	providers: [BillingsService],
	exports: [BillingsService],
})
export class BillingsModule {}
