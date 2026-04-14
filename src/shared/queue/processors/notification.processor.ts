import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq'
import { Logger } from '@nestjs/common'
import type { Job } from 'bullmq'
import { NotificationService } from '@/shared/websocket/notification.service'
import { DlqService } from '../dlq.service'
import { QUEUE_NAMES } from '../queue.constants'
import type { NotificationJobData } from '../queue.types'

@Processor(QUEUE_NAMES.NOTIFICATION)
export class NotificationProcessor extends WorkerHost {
	private readonly logger = new Logger(NotificationProcessor.name)

	constructor(
		private readonly notificationService: NotificationService,
		private readonly dlqService: DlqService,
	) {
		super()
	}

	async process(job: Job<NotificationJobData>): Promise<void> {
		await this.notificationService.create(job.data)
	}

	@OnWorkerEvent('active')
	onActive(job: Job): void {
		this.logger.debug(`Processing ${job.name} (id=${job.id})`)
	}

	@OnWorkerEvent('completed')
	onCompleted(job: Job): void {
		this.logger.debug(`Completed ${job.name} (id=${job.id})`)
	}

	@OnWorkerEvent('failed')
	async onFailed(job: Job, error: Error): Promise<void> {
		this.logger.warn(
			`Failed ${job.name} (id=${job.id}) attempt ${job.attemptsMade}: ${error.message}`,
		)
		await this.dlqService.handleFailedJob(job, error)
	}
}
