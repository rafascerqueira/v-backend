import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq'
import { Logger } from '@nestjs/common'
import type { Job } from 'bullmq'
import { DlqService } from '../dlq.service'
import { QUEUE_NAMES } from '../queue.constants'
import type { PdfJobData } from '../queue.types'

@Processor(QUEUE_NAMES.PDF)
export class PdfProcessor extends WorkerHost {
	private readonly logger = new Logger(PdfProcessor.name)

	constructor(private readonly dlqService: DlqService) {
		super()
	}

	async process(job: Job<PdfJobData>): Promise<void> {
		this.logger.log(`Processing PDF job "${job.name}" → ${job.data.outputPath}`)
		// TODO: implement PDF generation per job.name using pdfkit
		// Example: case 'invoice' → generate invoice PDF
		throw new Error(`PDF processor for job "${job.name}" is not yet implemented`)
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
