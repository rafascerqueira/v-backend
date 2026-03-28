import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq'
import { Logger } from '@nestjs/common'
import type { Job } from 'bullmq'
import { DlqService } from '../dlq.service'
import { IMAGE_JOBS, QUEUE_NAMES } from '../queue.constants'
import type { ImageJobData } from '../queue.types'

@Processor(QUEUE_NAMES.IMAGE)
export class ImageProcessor extends WorkerHost {
	private readonly logger = new Logger(ImageProcessor.name)

	constructor(private readonly dlqService: DlqService) {
		super()
	}

	async process(job: Job<ImageJobData>): Promise<void> {
		this.logger.log(`Processing image job "${job.name}": ${job.data.inputPath} → ${job.data.outputPath}`)

		switch (job.name) {
			case IMAGE_JOBS.RESIZE:
			case IMAGE_JOBS.COMPRESS:
			case IMAGE_JOBS.THUMBNAIL:
				// TODO: implement using sharp
				throw new Error(`Image processor for job "${job.name}" is not yet implemented`)

			default:
				throw new Error(`Unknown image job: ${job.name}`)
		}
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
		this.logger.warn(`Failed ${job.name} (id=${job.id}) attempt ${job.attemptsMade}: ${error.message}`)
		await this.dlqService.handleFailedJob(job, error)
	}
}
