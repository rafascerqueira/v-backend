import { getQueueToken } from '@nestjs/bullmq'
import { Logger } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { OUTBOX_JOBS, QUEUE_NAMES } from '@/shared/queue/queue.constants'
import {
	DOMAIN_EVENT_REPOSITORY,
	type RelayBatchResult,
} from '@/shared/repositories/domain-event.repository'
import { DOMAIN_EVENT_TYPES, type DomainEvent, type DomainEventHandler } from './domain-event.types'
import { DomainEventHandlerRegistry } from './domain-event-handler.registry'
import {
	OutboxRelayService,
	RELAY_BATCH_SIZE,
	RELAY_MAX_BATCHES_PER_RUN,
} from './outbox-relay.service'

const event = (id: string, eventType: string = DOMAIN_EVENT_TYPES.ORDER_CREATED): DomainEvent => ({
	id,
	sellerId: 'seller-1',
	aggregateType: 'order',
	aggregateId: '1',
	eventType,
	payload: {},
	occurredAt: new Date('2026-11-02T12:00:00Z'),
})

const handler = (name: string): DomainEventHandler => ({
	name,
	eventTypes: [DOMAIN_EVENT_TYPES.ORDER_CREATED],
	handle: jest.fn(),
})

describe('OutboxRelayService', () => {
	let service: OutboxRelayService
	let registry: DomainEventHandlerRegistry
	const repository = { relayPending: jest.fn(), findById: jest.fn() }
	const effectsQueue = { add: jest.fn() }
	const outboxQueue = { add: jest.fn() }

	/** Feeds `events` to the publish callback the way the repository does. */
	const relayWith = (events: DomainEvent[]) =>
		repository.relayPending.mockImplementationOnce(
			async (_limit: number, publish: (e: DomainEvent) => Promise<void>) => {
				const result: RelayBatchResult = { locked: events.length, published: 0, failures: [] }
				for (const e of events) {
					try {
						await publish(e)
						result.published++
					} catch (error) {
						result.failures.push({
							eventId: e.id,
							eventType: e.eventType,
							attempts: 1,
							error: String(error),
						})
					}
				}
				return result
			},
		)

	beforeEach(async () => {
		jest.resetAllMocks()
		const module = await Test.createTestingModule({
			providers: [
				OutboxRelayService,
				DomainEventHandlerRegistry,
				{ provide: DOMAIN_EVENT_REPOSITORY, useValue: repository },
				{ provide: getQueueToken(QUEUE_NAMES.DOMAIN_EFFECTS), useValue: effectsQueue },
				{ provide: getQueueToken(QUEUE_NAMES.OUTBOX), useValue: outboxQueue },
			],
		}).compile()
		service = module.get(OutboxRelayService)
		registry = module.get(DomainEventHandlerRegistry)
		jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
		jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
	})

	describe('relayPending', () => {
		it('enqueues one effect job per subscribed handler with a deterministic job id', async () => {
			registry.register(handler('notify'))
			registry.register(handler('audit'))
			relayWith([event('evt-1')])

			const result = await service.relayPending()

			expect(repository.relayPending).toHaveBeenCalledWith(RELAY_BATCH_SIZE, expect.any(Function))
			expect(effectsQueue.add).toHaveBeenCalledTimes(2)
			expect(effectsQueue.add).toHaveBeenCalledWith(
				'notify',
				{ eventId: 'evt-1', handler: 'notify' },
				{ jobId: 'evt-1.notify' },
			)
			expect(effectsQueue.add).toHaveBeenCalledWith(
				'audit',
				{ eventId: 'evt-1', handler: 'audit' },
				{ jobId: 'evt-1.audit' },
			)
			expect(result).toEqual({ published: 1, failed: 0 })
		})

		it('publishes events nobody subscribes to without enqueuing anything', async () => {
			registry.register(handler('notify'))
			relayWith([event('evt-1', DOMAIN_EVENT_TYPES.ORDER_DELETED)])

			const result = await service.relayPending()

			expect(effectsQueue.add).not.toHaveBeenCalled()
			expect(result).toEqual({ published: 1, failed: 0 })
		})

		it('reports an enqueue failure so the repository leaves the event pending', async () => {
			registry.register(handler('notify'))
			effectsQueue.add.mockRejectedValueOnce(new Error('redis down'))
			relayWith([event('evt-1')])

			const result = await service.relayPending()

			expect(result).toEqual({ published: 0, failed: 1 })
		})

		it('keeps draining full batches, and stops on a short one', async () => {
			const full: RelayBatchResult = {
				locked: RELAY_BATCH_SIZE,
				published: RELAY_BATCH_SIZE,
				failures: [],
			}
			repository.relayPending
				.mockResolvedValueOnce(full)
				.mockResolvedValueOnce(full)
				.mockResolvedValueOnce({ locked: 3, published: 3, failures: [] })

			const result = await service.relayPending()

			expect(repository.relayPending).toHaveBeenCalledTimes(3)
			expect(result.published).toBe(2 * RELAY_BATCH_SIZE + 3)
		})

		it('caps the batches per run so a backlog cannot monopolise the worker', async () => {
			repository.relayPending.mockResolvedValue({
				locked: RELAY_BATCH_SIZE,
				published: RELAY_BATCH_SIZE,
				failures: [],
			})

			await service.relayPending()

			expect(repository.relayPending).toHaveBeenCalledTimes(RELAY_MAX_BATCHES_PER_RUN)
		})

		it('backs off after a failing batch instead of hammering Redis', async () => {
			repository.relayPending.mockResolvedValue({
				locked: RELAY_BATCH_SIZE,
				published: RELAY_BATCH_SIZE - 1,
				failures: [{ eventId: 'evt-9', eventType: 'order.created', attempts: 1, error: 'x' }],
			})

			await service.relayPending()

			expect(repository.relayPending).toHaveBeenCalledTimes(1)
		})

		it('logs [OUTBOX_STUCK] every 10th failed attempt, a warning otherwise', async () => {
			const error = jest.spyOn(Logger.prototype, 'error')
			const warn = jest.spyOn(Logger.prototype, 'warn')
			repository.relayPending.mockResolvedValueOnce({
				locked: 3,
				published: 0,
				failures: [
					{ eventId: 'a', eventType: 'order.created', attempts: 9, error: 'x' },
					{ eventId: 'b', eventType: 'order.created', attempts: 10, error: 'x' },
					{ eventId: 'c', eventType: 'order.created', attempts: 20, error: 'x' },
				],
			})

			await service.relayPending()

			const stuck = error.mock.calls.filter(([msg]) => String(msg).startsWith('[OUTBOX_STUCK]'))
			expect(stuck).toHaveLength(2)
			expect(String(stuck[0][0])).toContain('event b')
			expect(warn).toHaveBeenCalledWith(expect.stringContaining('event a'))
		})
	})

	describe('kick', () => {
		it('adds a relay run under a fixed job id so concurrent kicks collapse', async () => {
			await service.kick()

			expect(outboxQueue.add).toHaveBeenCalledWith(
				OUTBOX_JOBS.RELAY,
				{},
				expect.objectContaining({
					jobId: 'relay-kick',
					removeOnComplete: true,
					removeOnFail: true,
				}),
			)
		})

		it('never throws: the event is committed and the schedule will relay it', async () => {
			outboxQueue.add.mockRejectedValueOnce(new Error('redis down'))

			await expect(service.kick()).resolves.toBeUndefined()
		})
	})
})
