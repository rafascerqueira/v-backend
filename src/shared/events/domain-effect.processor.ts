import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq'
import { Inject, Logger } from '@nestjs/common'
import type { Job } from 'bullmq'
import { DlqService } from '@/shared/queue/dlq.service'
import { QUEUE_NAMES } from '@/shared/queue/queue.constants'
import {
	DOMAIN_EVENT_REPOSITORY,
	type DomainEventRepository,
} from '@/shared/repositories/domain-event.repository'
import { TenantContext } from '@/shared/tenant/tenant.context'
import type { DomainEffectJobData } from './domain-event.types'
import { DomainEventHandlerRegistry } from './domain-event-handler.registry'

/** Runs one handler for one stored event. Retries/backoff come from the queue options. */
@Processor(QUEUE_NAMES.DOMAIN_EFFECTS)
export class DomainEffectProcessor extends WorkerHost {
	private readonly logger = new Logger(DomainEffectProcessor.name)

	constructor(
		@Inject(DOMAIN_EVENT_REPOSITORY) private readonly repository: DomainEventRepository,
		private readonly registry: DomainEventHandlerRegistry,
		private readonly tenantContext: TenantContext,
		private readonly dlqService: DlqService,
	) {
		super()
	}

	async process(job: Job<DomainEffectJobData>): Promise<void> {
		const { eventId, handler: handlerName } = job.data

		// Both cases are permanent, so retrying would only fill the DLQ: the handler
		// was removed/renamed after the job was queued, or the event went away with
		// its account (ON DELETE CASCADE).
		const handler = this.registry.get(handlerName)
		if (!handler) {
			this.logger.warn(`No domain event handler "${handlerName}" for event ${eventId}; skipping`)
			return
		}
		const event = await this.repository.findById(eventId)
		if (!event) {
			this.logger.warn(`Domain event ${eventId} no longer exists; skipping "${handlerName}"`)
			return
		}

		// Tenant-scoped repositories work inside handlers exactly as in a request.
		if (event.sellerId) {
			await this.tenantContext.run({ sellerId: event.sellerId, role: 'seller' }, () =>
				handler.handle(event),
			)
		} else {
			await handler.handle(event)
		}
	}

	@OnWorkerEvent('failed')
	async onFailed(job: Job<DomainEffectJobData>, error: Error): Promise<void> {
		this.logger.warn(
			`Effect "${job.data.handler}" for event ${job.data.eventId} failed ` +
				`(attempt ${job.attemptsMade}): ${error.message}`,
		)
		await this.dlqService.handleFailedJob(job, error)
	}
}
