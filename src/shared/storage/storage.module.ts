import { Global, Module } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { LocalStorageProvider } from './local-storage.provider'
import { S3StorageProvider } from './s3-storage.provider'
import { STORAGE_PROVIDER } from './storage.types'

/**
 * Provides the active {@link StorageProvider} under {@link STORAGE_PROVIDER},
 * chosen from `STORAGE_DRIVER` config at startup.
 */
@Global()
@Module({
	providers: [
		{
			provide: STORAGE_PROVIDER,
			useFactory: (configService: ConfigService) => {
				const driver = configService.get<string>('storage.driver', 'local')
				return driver === 's3'
					? new S3StorageProvider(configService)
					: new LocalStorageProvider(configService)
			},
			inject: [ConfigService],
		},
	],
	exports: [STORAGE_PROVIDER],
})
export class StorageModule {}
