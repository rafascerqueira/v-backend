import { Module } from "@nestjs/common";
import { PrismaModule } from "@/shared/prisma/prisma.module";
import { CatalogController } from "./controllers/catalog.controller";
import { StoreSettingsController } from "./controllers/store-settings.controller";
import { CatalogService } from "./services/catalog.service";
import { StoreSettingsService } from "./services/store-settings.service";

@Module({
	imports: [PrismaModule],
	controllers: [CatalogController, StoreSettingsController],
	providers: [CatalogService, StoreSettingsService],
	exports: [CatalogService, StoreSettingsService],
})
export class CatalogModule {}
