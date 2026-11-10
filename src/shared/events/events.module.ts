import { BullModule } from '@nestjs/bullmq'
import { Global, Module } from '@nestjs/common'
import { QUEUE_NAMES } from '@/shared/queue/queue.constants'
import { DOMAIN_EVENT_REPOSITORY } from '@/shared/repositories/domain-event.repository'
import { IDEMPOTENCY_KEY_REPOSITORY } from '@/shared/repositories/idempotency-key.repository'
import { DomainEffectProcessor } from './domain-effect.processor'
import { DomainEventHandlerRegistry } from './domain-event-handler.registry'
import { OutboxProcessor } from './outbox.processor'
import { OutboxRelayService } from './outbox-relay.service'
import { PrismaDomainEventRepository } from './repositories/prisma-domain-event.repository'
import { PrismaIdempotencyKeyRepository } from './repositories/prisma-idempotency-key.repository'

/**
 * Transactional outbox (Phase 1B). Global so any module can register handlers and
 * kick the relay. Effect jobs get more retries than the queue default: a handler
 * failing is usually transient (DB/SMTP), and exhausted jobs land in the DLQ.
 */
@Global()
@Module({
	imports: [
		BullModule.registerQueue(
			{ name: QUEUE_NAMES.OUTBOX, defaultJobOptions: { attempts: 1 } },
			{
				name: QUEUE_NAMES.DOMAIN_EFFECTS,
				defaultJobOptions: {
					attempts: 5,
					backoff: { type: 'exponential', delay: 5_000 },
					removeOnComplete: { count: 1_000 },
					removeOnFail: false,
				},
			},
		),
	],
	providers: [
		DomainEventHandlerRegistry,
		OutboxRelayService,
		OutboxProcessor,
		DomainEffectProcessor,
		{ provide: DOMAIN_EVENT_REPOSITORY, useClass: PrismaDomainEventRepository },
		{ provide: IDEMPOTENCY_KEY_REPOSITORY, useClass: PrismaIdempotencyKeyRepository },
	],
	exports: [DomainEventHandlerRegistry, OutboxRelayService],
})
export class EventsModule {}
