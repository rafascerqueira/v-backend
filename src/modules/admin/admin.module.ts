import { Global, Module } from "@nestjs/common";
import { PrismaModule } from "@/shared/prisma/prisma.module";
import { AdminController } from "./controllers/admin.controller";
import { SettingsController } from "./controllers/settings.controller";
import { AdminService } from "./services/admin.service";
import { SettingsService } from "./services/settings.service";

@Global()
@Module({
	imports: [PrismaModule],
	controllers: [AdminController, SettingsController],
	providers: [AdminService, SettingsService],
	exports: [AdminService, SettingsService],
})
export class AdminModule {}
