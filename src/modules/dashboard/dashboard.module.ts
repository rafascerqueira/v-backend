import { Module } from '@nestjs/common'
import { PrismaModule } from '@/shared/prisma/prisma.module'
import { DASHBOARD_REPOSITORY } from '@/shared/repositories/dashboard.repository'
import { DashboardController } from './controllers/dashboard.controller'
import { PrismaDashboardRepository } from './repositories/prisma-dashboard.repository'
import { DashboardService } from './services/dashboard.service'

@Module({
	imports: [PrismaModule],
	controllers: [DashboardController],
	providers: [
		DashboardService,
		{
			provide: DASHBOARD_REPOSITORY,
			useClass: PrismaDashboardRepository,
		},
	],
})
export class DashboardModule {}
