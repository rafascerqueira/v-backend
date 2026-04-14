import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq'
import { Logger } from '@nestjs/common'
import type { Job } from 'bullmq'
import { EmailService } from '@/shared/email/email.service'
import { DlqService } from '../dlq.service'
import { EMAIL_JOBS, QUEUE_NAMES } from '../queue.constants'
import type {
	PasswordResetEmailJobData,
	SendEmailJobData,
	VerifyEmailJobData,
	WelcomeEmailJobData,
} from '../queue.types'

type EmailJobData =
	| SendEmailJobData
	| PasswordResetEmailJobData
	| VerifyEmailJobData
	| WelcomeEmailJobData

@Processor(QUEUE_NAMES.EMAIL)
export class EmailProcessor extends WorkerHost {
	private readonly logger = new Logger(EmailProcessor.name)

	constructor(
		private readonly emailService: EmailService,
		private readonly dlqService: DlqService,
	) {
		super()
	}

	async process(job: Job<EmailJobData>): Promise<void> {
		switch (job.name) {
			case EMAIL_JOBS.SEND: {
				const data = job.data as SendEmailJobData
				await this.emailService.sendEmail({
					to: data.to,
					subject: data.subject,
					html: data.html,
					text: data.text,
				})
				break
			}

			case EMAIL_JOBS.PASSWORD_RESET: {
				const data = job.data as PasswordResetEmailJobData
				await this.emailService.sendPasswordResetEmail(data.to, data.token, data.name)
				break
			}

			case EMAIL_JOBS.VERIFY_EMAIL: {
				const data = job.data as VerifyEmailJobData
				await this.emailService.sendEmailVerification(data.to, data.token, data.name)
				break
			}

			case EMAIL_JOBS.WELCOME: {
				const data = job.data as WelcomeEmailJobData
				await this.emailService.sendWelcomeEmail(data.to, data.name)
				break
			}

			default:
				this.logger.warn(`Unknown email job name: ${job.name}`)
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
		this.logger.warn(
			`Failed ${job.name} (id=${job.id}) attempt ${job.attemptsMade}: ${error.message}`,
		)
		await this.dlqService.handleFailedJob(job, error)
	}
}
