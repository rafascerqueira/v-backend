import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq'
import { Inject, Logger, type OnModuleInit } from '@nestjs/common'
import type { Job, Queue } from 'bullmq'
import { OUTBOX_JOBS, QUEUE_NAMES } from '@/shared/queue/queue.constants'
import {
	IDEMPOTENCY_KEY_REPOSITORY,
	type IdempotencyKeyRepository,
} from '@/shared/repositories/idempotency-key.repository'
import { OutboxRelayService } from './outbox-relay.service'

export const RELAY_EVERY_MS = 5_000
export const IDEMPOTENCY_KEY_TTL_DAYS = 7
const PURGE_PATTERN = '30 3 * * *' // daily, 03:30

@Processor(QUEUE_NAMES.OUTBOX)
export class OutboxProcessor extends WorkerHost implements OnModuleInit {
	private readonly logger = new Logger(OutboxProcessor.name)

	constructor(
		private readonly relayService: OutboxRelayService,
		@Inject(IDEMPOTENCY_KEY_REPOSITORY)
		private readonly idempotencyKeys: IdempotencyKeyRepository,
		@InjectQueue(QUEUE_NAMES.OUTBOX) private readonly queue: Queue,
	) {
		super()
	}

	async onModuleInit(): Promise<void> {
		// Job schedulers are upserted by id, so re-running this on every boot (or on
		// several instances) keeps exactly one schedule each and applies new settings.
		// Guarded so a Redis hiccup can't crash startup; kicks still relay meanwhile.
		try {
			await this.queue.upsertJobScheduler(
				'outbox-relay',
				{ every: RELAY_EVERY_MS },
				{
					name: OUTBOX_JOBS.RELAY,
					opts: { removeOnComplete: true, removeOnFail: { count: 50 } },
				},
			)
			await this.queue.upsertJobScheduler(
				'outbox-purge-idempotency-keys',
				{ pattern: PURGE_PATTERN },
				{
					name: OUTBOX_JOBS.PURGE_IDEMPOTENCY_KEYS,
					opts: { removeOnComplete: true, removeOnFail: { count: 50 } },
				},
			)
		} catch (error) {
			this.logger.error('Failed to schedule the outbox relay', error)
		}
	}

	async process(job: Job): Promise<void> {
		switch (job.name) {
			case OUTBOX_JOBS.RELAY:
				await this.relayService.relayPending()
				return
			case OUTBOX_JOBS.PURGE_IDEMPOTENCY_KEYS: {
				const cutoff = new Date(Date.now() - IDEMPOTENCY_KEY_TTL_DAYS * 24 * 60 * 60 * 1000)
				const deleted = await this.idempotencyKeys.deleteCreatedBefore(cutoff)
				this.logger.log(`Purged ${deleted} idempotency key(s) older than ${cutoff.toISOString()}`)
				return
			}
			default:
				this.logger.warn(`Ignoring unknown outbox job "${job.name}"`)
		}
	}

	@OnWorkerEvent('failed')
	onFailed(job: Job, error: Error): void {
		this.logger.error(`Outbox job ${job.name} (id=${job.id}) failed: ${error.message}`)
	}
}
