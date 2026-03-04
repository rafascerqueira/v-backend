import { Global, Module } from '@nestjs/common'
import { PrismaModule } from '@/shared/prisma/prisma.module'
import { ADMIN_REPOSITORY } from '@/shared/repositories/admin.repository'
import { SETTINGS_REPOSITORY } from '@/shared/repositories/settings.repository'
import { AdminController } from './controllers/admin.controller'
import { SettingsController } from './controllers/settings.controller'
import { PrismaAdminRepository } from './repositories/prisma-admin.repository'
import { PrismaSettingsRepository } from './repositories/prisma-settings.repository'
import { AdminService } from './services/admin.service'
import { SettingsService } from './services/settings.service'

@Global()
@Module({
	imports: [PrismaModule],
	controllers: [AdminController, SettingsController],
	providers: [
		AdminService,
		SettingsService,
		{
			provide: ADMIN_REPOSITORY,
			useClass: PrismaAdminRepository,
		},
		{
			provide: SETTINGS_REPOSITORY,
			useClass: PrismaSettingsRepository,
		},
	],
	exports: [AdminService, SettingsService],
})
export class AdminModule {}
