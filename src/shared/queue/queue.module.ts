import { BullModule } from '@nestjs/bullmq'
import { Global, Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { DlqService } from './dlq.service'
import { DeadLetterProcessor } from './processors/dead-letter.processor'
import { EmailProcessor } from './processors/email.processor'
import { ExcelProcessor } from './processors/excel.processor'
import { ImageProcessor } from './processors/image.processor'
import { NotificationProcessor } from './processors/notification.processor'
import { PdfProcessor } from './processors/pdf.processor'
import { QUEUE_NAMES } from './queue.constants'
import { QueueProducer } from './queue.producer'

@Global()
@Module({
	imports: [
		BullModule.forRootAsync({
			imports: [ConfigModule],
			inject: [ConfigService],
			useFactory: (config: ConfigService) => ({
				connection: {
					host: config.get<string>('redis.host', 'localhost'),
					port: config.get<number>('redis.port', 6379),
					password: config.get<string>('redis.password'),
					db: config.get<number>('redis.db', 0),
				},
				defaultJobOptions: {
					attempts: 3,
					backoff: { type: 'exponential', delay: 5_000 },
					removeOnComplete: { count: 100 },
					removeOnFail: false,
				},
			}),
		}),
		BullModule.registerQueue(
			{ name: QUEUE_NAMES.EMAIL },
			{ name: QUEUE_NAMES.NOTIFICATION },
			{ name: QUEUE_NAMES.PDF },
			{ name: QUEUE_NAMES.IMAGE },
			{ name: QUEUE_NAMES.EXCEL },
			{
				name: QUEUE_NAMES.DEAD_LETTER,
				defaultJobOptions: { attempts: 1, removeOnFail: false, removeOnComplete: false },
			},
		),
	],
	providers: [
		DlqService,
		QueueProducer,
		EmailProcessor,
		NotificationProcessor,
		PdfProcessor,
		ImageProcessor,
		ExcelProcessor,
		DeadLetterProcessor,
	],
	exports: [QueueProducer],
})
export class QueueModule {}
