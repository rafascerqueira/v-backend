import { InjectQueue } from '@nestjs/bullmq'
import { Injectable, Logger } from '@nestjs/common'
import { Queue } from 'bullmq'
import { EMAIL_JOBS, IMAGE_JOBS, QUEUE_NAMES } from './queue.constants'
import type {
	ExcelJobData,
	ImageJobData,
	NotificationJobData,
	PasswordResetEmailJobData,
	PdfJobData,
	SendEmailJobData,
	VerifyEmailJobData,
	WelcomeEmailJobData,
} from './queue.types'

@Injectable()
export class QueueProducer {
	private readonly logger = new Logger(QueueProducer.name)

	constructor(
		@InjectQueue(QUEUE_NAMES.EMAIL) private readonly emailQueue: Queue,
		@InjectQueue(QUEUE_NAMES.NOTIFICATION) private readonly notificationQueue: Queue,
		@InjectQueue(QUEUE_NAMES.PDF) private readonly pdfQueue: Queue,
		@InjectQueue(QUEUE_NAMES.IMAGE) private readonly imageQueue: Queue,
		@InjectQueue(QUEUE_NAMES.EXCEL) private readonly excelQueue: Queue,
	) {}

	// ─── Email ──────────────────────────────────────────────────────────────────

	async sendEmail(data: SendEmailJobData): Promise<void> {
		await this.emailQueue.add(EMAIL_JOBS.SEND, data)
		this.logger.debug(`Enqueued email to ${data.to}: "${data.subject}"`)
	}

	async sendPasswordResetEmail(data: PasswordResetEmailJobData): Promise<void> {
		await this.emailQueue.add(EMAIL_JOBS.PASSWORD_RESET, data)
		this.logger.debug(`Enqueued password-reset email to ${data.to}`)
	}

	async sendEmailVerification(data: VerifyEmailJobData): Promise<void> {
		await this.emailQueue.add(EMAIL_JOBS.VERIFY_EMAIL, data)
		this.logger.debug(`Enqueued verify-email to ${data.to}`)
	}

	async sendWelcomeEmail(data: WelcomeEmailJobData): Promise<void> {
		await this.emailQueue.add(EMAIL_JOBS.WELCOME, data)
		this.logger.debug(`Enqueued welcome email to ${data.to}`)
	}

	// ─── Notification ───────────────────────────────────────────────────────────

	async createNotification(data: NotificationJobData): Promise<void> {
		await this.notificationQueue.add('create', data)
		this.logger.debug(`Enqueued notification for user ${data.userId}: "${data.title}"`)
	}

	// ─── PDF ────────────────────────────────────────────────────────────────────

	async generatePdf(jobName: string, data: PdfJobData): Promise<void> {
		await this.pdfQueue.add(jobName, data)
		this.logger.debug(`Enqueued PDF job "${jobName}"`)
	}

	// ─── Image ──────────────────────────────────────────────────────────────────

	async resizeImage(data: ImageJobData): Promise<void> {
		await this.imageQueue.add(IMAGE_JOBS.RESIZE, data)
		this.logger.debug(`Enqueued image resize: ${data.inputPath}`)
	}

	async compressImage(data: ImageJobData): Promise<void> {
		await this.imageQueue.add(IMAGE_JOBS.COMPRESS, data)
		this.logger.debug(`Enqueued image compress: ${data.inputPath}`)
	}

	async generateThumbnail(data: ImageJobData): Promise<void> {
		await this.imageQueue.add(IMAGE_JOBS.THUMBNAIL, data)
		this.logger.debug(`Enqueued thumbnail: ${data.inputPath}`)
	}

	// ─── Excel ──────────────────────────────────────────────────────────────────

	async generateExcel(jobName: string, data: ExcelJobData): Promise<void> {
		await this.excelQueue.add(jobName, data)
		this.logger.debug(`Enqueued Excel job "${jobName}"`)
	}
}
