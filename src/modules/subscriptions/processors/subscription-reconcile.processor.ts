import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq'
import { Logger, type OnModuleInit } from '@nestjs/common'
import type { Job, Queue } from 'bullmq'
import { QUEUE_NAMES, SUBSCRIPTION_JOBS } from '@/shared/queue/queue.constants'
import { SubscriptionReconcileService } from '../services/subscription-reconcile.service'

@Processor(QUEUE_NAMES.SUBSCRIPTION)
export class SubscriptionReconcileProcessor extends WorkerHost implements OnModuleInit {
	private readonly logger = new Logger(SubscriptionReconcileProcessor.name)

	constructor(
		private readonly reconcileService: SubscriptionReconcileService,
		@InjectQueue(QUEUE_NAMES.SUBSCRIPTION) private readonly queue: Queue,
	) {
		super()
	}

	async onModuleInit(): Promise<void> {
		// Schedule the daily reconciliation (04:00). BullMQ dedups repeatable jobs by
		// their repeat key (name + pattern), so re-adding on every boot is idempotent.
		// Guarded so a transient Redis hiccup can't crash app startup.
		try {
			await this.queue.add(
				SUBSCRIPTION_JOBS.RECONCILE,
				{},
				{ repeat: { pattern: '0 4 * * *' }, removeOnComplete: true, removeOnFail: false },
			)
			this.logger.log('Scheduled daily subscription reconciliation (04:00)')
		} catch (error) {
			this.logger.error('Failed to schedule subscription reconciliation', error)
		}
	}

	async process(job: Job): Promise<void> {
		if (job.name !== SUBSCRIPTION_JOBS.RECONCILE) return
		const result = await this.reconcileService.reconcile()
		this.logger.log(`Scheduled reconcile: ${JSON.stringify(result)}`)
	}

	@OnWorkerEvent('failed')
	onFailed(job: Job, error: Error): void {
		this.logger.error(`Reconcile job ${job.id} failed: ${error.message}`)
	}
}
