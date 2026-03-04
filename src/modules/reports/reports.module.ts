import { Module } from '@nestjs/common'
import { PrismaModule } from '@/shared/prisma/prisma.module'
import { REPORTS_REPOSITORY } from '@/shared/repositories/reports.repository'
import { ReportsController } from './controllers/reports.controller'
import { PrismaReportsRepository } from './repositories/prisma-reports.repository'
import { ReportsService } from './services/reports.service'

@Module({
	imports: [PrismaModule],
	controllers: [ReportsController],
	providers: [
		ReportsService,
		{
			provide: REPORTS_REPOSITORY,
			useClass: PrismaReportsRepository,
		},
	],
})
export class ReportsModule {}
