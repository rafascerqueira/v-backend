import { InjectQueue } from '@nestjs/bullmq'
import { Injectable, Logger } from '@nestjs/common'
import type { Job } from 'bullmq'
import { Queue } from 'bullmq'
import { QUEUE_NAMES } from './queue.constants'
import type { DeadLetterJobData } from './queue.types'

@Injectable()
export class DlqService {
	private readonly logger = new Logger(DlqService.name)

	constructor(@InjectQueue(QUEUE_NAMES.DEAD_LETTER) private readonly dlq: Queue) {}

	async handleFailedJob(job: Job, error: Error): Promise<void> {
		const maxAttempts = job.opts.attempts ?? 1
		if (job.attemptsMade < maxAttempts) return

		const payload: DeadLetterJobData = {
			originalQueue: job.queueName,
			originalJobId: job.id ?? 'unknown',
			originalJobName: job.name,
			originalData: job.data,
			failedReason: error.message,
			failedAt: new Date().toISOString(),
			attemptsMade: job.attemptsMade,
		}

		await this.dlq.add('dlq', payload, { attempts: 1, removeOnFail: false })

		this.logger.error(
			`[DLQ] "${job.name}" (id=${job.id}) from queue "${job.queueName}" ` +
				`exhausted ${job.attemptsMade} attempts — reason: ${error.message}`,
		)
	}
}
