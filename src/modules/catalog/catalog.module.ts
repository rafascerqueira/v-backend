import { Module } from '@nestjs/common'
import { PrismaModule } from '@/shared/prisma/prisma.module'
import { CATALOG_REPOSITORY } from '@/shared/repositories/catalog.repository'
import { STORE_SETTINGS_REPOSITORY } from '@/shared/repositories/store-settings.repository'
import { CatalogController } from './controllers/catalog.controller'
import { StoreSettingsController } from './controllers/store-settings.controller'
import { PrismaCatalogRepository } from './repositories/prisma-catalog.repository'
import { PrismaStoreSettingsRepository } from './repositories/prisma-store-settings.repository'
import { CatalogService } from './services/catalog.service'
import { StoreSettingsService } from './services/store-settings.service'

@Module({
	imports: [PrismaModule],
	controllers: [CatalogController, StoreSettingsController],
	providers: [
		CatalogService,
		StoreSettingsService,
		{
			provide: CATALOG_REPOSITORY,
			useClass: PrismaCatalogRepository,
		},
		{
			provide: STORE_SETTINGS_REPOSITORY,
			useClass: PrismaStoreSettingsRepository,
		},
	],
	exports: [CatalogService, StoreSettingsService],
})
export class CatalogModule {}
