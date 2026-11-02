import { getQueueToken } from '@nestjs/bullmq'
import { Logger } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import type { Job } from 'bullmq'
import { OUTBOX_JOBS, QUEUE_NAMES } from '@/shared/queue/queue.constants'
import { IDEMPOTENCY_KEY_REPOSITORY } from '@/shared/repositories/idempotency-key.repository'
import { IDEMPOTENCY_KEY_TTL_DAYS, OutboxProcessor, RELAY_EVERY_MS } from './outbox.processor'
import { OutboxRelayService } from './outbox-relay.service'

const job = (name: string) => ({ id: 'j1', name, data: {} }) as unknown as Job

describe('OutboxProcessor', () => {
	let processor: OutboxProcessor
	const relayService = { relayPending: jest.fn() }
	const idempotencyKeys = { deleteCreatedBefore: jest.fn() }
	const queue = { upsertJobScheduler: jest.fn() }

	beforeEach(async () => {
		jest.resetAllMocks()
		const module = await Test.createTestingModule({
			providers: [
				OutboxProcessor,
				{ provide: OutboxRelayService, useValue: relayService },
				{ provide: IDEMPOTENCY_KEY_REPOSITORY, useValue: idempotencyKeys },
				{ provide: getQueueToken(QUEUE_NAMES.OUTBOX), useValue: queue },
			],
		}).compile()
		processor = module.get(OutboxProcessor)
		jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
		jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
		jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
	})

	describe('onModuleInit', () => {
		it('upserts the relay schedule (every 5 s) and the daily purge, by stable ids', async () => {
			await processor.onModuleInit()

			expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
				'outbox-relay',
				{ every: RELAY_EVERY_MS },
				expect.objectContaining({ name: OUTBOX_JOBS.RELAY }),
			)
			expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
				'outbox-purge-idempotency-keys',
				{ pattern: '30 3 * * *' },
				expect.objectContaining({ name: OUTBOX_JOBS.PURGE_IDEMPOTENCY_KEYS }),
			)
		})

		it('does not crash the boot when Redis is unavailable', async () => {
			queue.upsertJobScheduler.mockRejectedValueOnce(new Error('redis down'))

			await expect(processor.onModuleInit()).resolves.toBeUndefined()
		})
	})

	describe('process', () => {
		it('runs the relay on relay jobs', async () => {
			relayService.relayPending.mockResolvedValueOnce({ published: 1, failed: 0 })

			await processor.process(job(OUTBOX_JOBS.RELAY))

			expect(relayService.relayPending).toHaveBeenCalledTimes(1)
		})

		it('purges idempotency keys older than 7 days', async () => {
			jest.useFakeTimers({ now: new Date('2026-11-10T03:30:00Z') })
			idempotencyKeys.deleteCreatedBefore.mockResolvedValueOnce(4)

			await processor.process(job(OUTBOX_JOBS.PURGE_IDEMPOTENCY_KEYS))

			expect(IDEMPOTENCY_KEY_TTL_DAYS).toBe(7)
			expect(idempotencyKeys.deleteCreatedBefore).toHaveBeenCalledWith(
				new Date('2026-11-03T03:30:00Z'),
			)
			jest.useRealTimers()
		})

		it('ignores unknown job names', async () => {
			await processor.process(job('something-else'))

			expect(relayService.relayPending).not.toHaveBeenCalled()
			expect(idempotencyKeys.deleteCreatedBefore).not.toHaveBeenCalled()
		})
	})
})
