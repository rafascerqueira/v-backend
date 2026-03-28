import { Processor, WorkerHost } from '@nestjs/bullmq'
import { Logger } from '@nestjs/common'
import type { Job } from 'bullmq'
import { QUEUE_NAMES } from '../queue.constants'
import type { DeadLetterJobData } from '../queue.types'

@Processor(QUEUE_NAMES.DEAD_LETTER)
export class DeadLetterProcessor extends WorkerHost {
	private readonly logger = new Logger(DeadLetterProcessor.name)

	async process(job: Job<DeadLetterJobData>): Promise<void> {
		const { originalQueue, originalJobName, originalJobId, attemptsMade, failedReason, failedAt } =
			job.data

		this.logger.error(
			`[DEAD-LETTER] queue="${originalQueue}" job="${originalJobName}" id="${originalJobId}" ` +
				`attempts=${attemptsMade} failedAt=${failedAt} reason="${failedReason}"`,
		)

		// Jobs are kept in Redis (removeOnFail: false) for manual inspection or replay.
		// To replay a job, move it back to its original queue via the BullMQ API or CLI.
	}
}
