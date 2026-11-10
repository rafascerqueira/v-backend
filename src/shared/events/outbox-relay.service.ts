import { InjectQueue } from '@nestjs/bullmq'
import { Inject, Injectable, Logger } from '@nestjs/common'
import type { Queue } from 'bullmq'
import { OUTBOX_JOBS, QUEUE_NAMES } from '@/shared/queue/queue.constants'
import {
	DOMAIN_EVENT_REPOSITORY,
	type DomainEventRepository,
} from '@/shared/repositories/domain-event.repository'
import { type DomainEffectJobData, type DomainEvent, domainEffectJobId } from './domain-event.types'
import { DomainEventHandlerRegistry } from './domain-event-handler.registry'

export const RELAY_BATCH_SIZE = 100
/** Bounds one relay run so a backlog can't monopolise the outbox worker. */
export const RELAY_MAX_BATCHES_PER_RUN = 10
/** Log `[OUTBOX_STUCK]` every this many failed publish attempts of one event. */
export const OUTBOX_STUCK_EVERY_ATTEMPTS = 10

const KICK_JOB_ID = 'relay-kick'

export interface RelayRunResult {
	published: number
	failed: number
}

@Injectable()
export class OutboxRelayService {
	private readonly logger = new Logger(OutboxRelayService.name)

	constructor(
		@Inject(DOMAIN_EVENT_REPOSITORY) private readonly repository: DomainEventRepository,
		private readonly registry: DomainEventHandlerRegistry,
		@InjectQueue(QUEUE_NAMES.DOMAIN_EFFECTS) private readonly effectsQueue: Queue,
		@InjectQueue(QUEUE_NAMES.OUTBOX) private readonly outboxQueue: Queue,
	) {}

	/**
	 * Publishes pending events, batch after batch, until a batch comes back short, one
	 * fails, or the per-run cap is hit (the next tick continues). Failed events stay
	 * pending and are retried on later runs.
	 */
	async relayPending(): Promise<RelayRunResult> {
		let published = 0
		let failed = 0

		for (let batch = 0; batch < RELAY_MAX_BATCHES_PER_RUN; batch++) {
			const result = await this.repository.relayPending(RELAY_BATCH_SIZE, (event) =>
				this.publish(event),
			)
			published += result.published
			failed += result.failures.length

			for (const failure of result.failures) {
				if (failure.attempts % OUTBOX_STUCK_EVERY_ATTEMPTS === 0) {
					this.logger.error(
						`[OUTBOX_STUCK] event ${failure.eventId} (${failure.eventType}) failed to publish ` +
							`${failure.attempts} times: ${failure.error}`,
					)
				} else {
					this.logger.warn(
						`Outbox publish failed for event ${failure.eventId} ` +
							`(attempt ${failure.attempts}): ${failure.error}`,
					)
				}
			}

			// A failure usually means Redis is struggling: back off until the next tick.
			if (result.locked < RELAY_BATCH_SIZE || result.failures.length > 0) break
		}

		if (published > 0) this.logger.debug(`Outbox relayed ${published} event(s)`)
		return { published, failed }
	}

	/**
	 * Best-effort nudge after a commit that appended events, so their effects run now
	 * rather than on the next scheduled tick. Never throws: the event is already
	 * committed and the 5-second schedule will publish it anyway.
	 */
	async kick(): Promise<void> {
		try {
			// A fixed job id collapses concurrent kicks into one pending relay run.
			await this.outboxQueue.add(
				OUTBOX_JOBS.RELAY,
				{},
				{ jobId: KICK_JOB_ID, removeOnComplete: true, removeOnFail: true },
			)
		} catch (error) {
			this.logger.warn(`Outbox kick failed (the scheduled relay will catch up): ${String(error)}`)
		}
	}

	/**
	 * One effect job per subscribed handler. The deterministic job id makes a
	 * re-publish (crash between enqueue and commit) a no-op while the job is still in
	 * Redis; after that, the handler's own dedupe key absorbs the repeat. An event with
	 * no subscribers is simply marked published.
	 */
	private async publish(event: DomainEvent): Promise<void> {
		for (const handler of this.registry.handlersFor(event.eventType)) {
			const data: DomainEffectJobData = { eventId: event.id, handler: handler.name }
			await this.effectsQueue.add(handler.name, data, {
				jobId: domainEffectJobId(event.id, handler.name),
			})
		}
	}
}
