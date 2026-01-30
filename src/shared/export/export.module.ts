import { Global, Module } from "@nestjs/common";
import { ExportController } from "./export.controller";
import { ExportService } from "./export.service";

@Global()
@Module({
	controllers: [ExportController],
	providers: [ExportService],
	exports: [ExportService],
})
export class ExportModule {}
