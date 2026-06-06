import { StorageModule } from '@infrastructure/storage/storage.module'
import { Global, Module } from '@nestjs/common'
import { UploadController } from './upload.controller'
import { UploadService } from './upload.service'

@Global()
@Module({
	imports: [StorageModule],
	controllers: [UploadController],
	providers: [UploadService],
	exports: [UploadService],
})
export class UploadModule {}
