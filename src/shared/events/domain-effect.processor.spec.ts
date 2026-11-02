import { Logger } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import type { Job } from 'bullmq'
import { DlqService } from '@/shared/queue/dlq.service'
import { DOMAIN_EVENT_REPOSITORY } from '@/shared/repositories/domain-event.repository'
import { TenantContext } from '@/shared/tenant/tenant.context'
import { DomainEffectProcessor } from './domain-effect.processor'
import {
	DOMAIN_EVENT_TYPES,
	type DomainEffectJobData,
	type DomainEvent,
	type DomainEventHandler,
} from './domain-event.types'
import { DomainEventHandlerRegistry } from './domain-event-handler.registry'

const job = (data: DomainEffectJobData) =>
	({
		id: `${data.eventId}.${data.handler}`,
		name: data.handler,
		data,
		attemptsMade: 5,
	}) as Job<DomainEffectJobData>

const storedEvent = (sellerId: string | null): DomainEvent => ({
	id: 'evt-1',
	sellerId,
	aggregateType: 'order',
	aggregateId: '1',
	eventType: DOMAIN_EVENT_TYPES.ORDER_CREATED,
	payload: { orderId: 1 },
	occurredAt: new Date('2026-11-02T12:00:00Z'),
})

describe('DomainEffectProcessor', () => {
	let processor: DomainEffectProcessor
	let registry: DomainEventHandlerRegistry
	const tenantContext = new TenantContext()
	const repository = { relayPending: jest.fn(), findById: jest.fn() }
	const dlqService = { handleFailedJob: jest.fn() }

	beforeEach(async () => {
		jest.resetAllMocks()
		const module = await Test.createTestingModule({
			providers: [
				DomainEffectProcessor,
				DomainEventHandlerRegistry,
				{ provide: DOMAIN_EVENT_REPOSITORY, useValue: repository },
				{ provide: TenantContext, useValue: tenantContext },
				{ provide: DlqService, useValue: dlqService },
			],
		}).compile()
		processor = module.get(DomainEffectProcessor)
		registry = module.get(DomainEventHandlerRegistry)
		jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
	})

	it("runs the handler with the stored event, inside the event's tenant context", async () => {
		let seenSeller: string | undefined
		const handler: DomainEventHandler = {
			name: 'notify',
			eventTypes: [DOMAIN_EVENT_TYPES.ORDER_CREATED],
			handle: jest.fn(async () => {
				seenSeller = tenantContext.getSellerId()
			}),
		}
		registry.register(handler)
		repository.findById.mockResolvedValueOnce(storedEvent('seller-1'))

		await processor.process(job({ eventId: 'evt-1', handler: 'notify' }))

		expect(repository.findById).toHaveBeenCalledWith('evt-1')
		expect(handler.handle).toHaveBeenCalledWith(storedEvent('seller-1'))
		expect(seenSeller).toBe('seller-1')
		expect(tenantContext.getSellerId()).toBeUndefined()
	})

	it('runs system events (no seller) without a tenant context', async () => {
		let seenSeller: string | undefined = 'unset'
		registry.register({
			name: 'notify',
			eventTypes: [DOMAIN_EVENT_TYPES.ORDER_CREATED],
			handle: jest.fn(async () => {
				seenSeller = tenantContext.getSellerId()
			}),
		})
		repository.findById.mockResolvedValueOnce(storedEvent(null))

		await processor.process(job({ eventId: 'evt-1', handler: 'notify' }))

		expect(seenSeller).toBeUndefined()
	})

	it('propagates handler errors so BullMQ retries the job', async () => {
		registry.register({
			name: 'notify',
			eventTypes: [DOMAIN_EVENT_TYPES.ORDER_CREATED],
			handle: jest.fn().mockRejectedValue(new Error('smtp down')),
		})
		repository.findById.mockResolvedValueOnce(storedEvent('seller-1'))

		await expect(processor.process(job({ eventId: 'evt-1', handler: 'notify' }))).rejects.toThrow(
			'smtp down',
		)
	})

	it('completes without retrying when the handler no longer exists', async () => {
		await expect(
			processor.process(job({ eventId: 'evt-1', handler: 'renamed' })),
		).resolves.toBeUndefined()
		expect(repository.findById).not.toHaveBeenCalled()
	})

	it('completes without retrying when the event is gone (account deleted)', async () => {
		const handle = jest.fn()
		registry.register({ name: 'notify', eventTypes: [DOMAIN_EVENT_TYPES.ORDER_CREATED], handle })
		repository.findById.mockResolvedValueOnce(null)

		await expect(
			processor.process(job({ eventId: 'evt-1', handler: 'notify' })),
		).resolves.toBeUndefined()
		expect(handle).not.toHaveBeenCalled()
	})

	it('routes failed jobs to the DLQ service (which only dead-letters the last attempt)', async () => {
		const failed = job({ eventId: 'evt-1', handler: 'notify' })
		const error = new Error('smtp down')

		await processor.onFailed(failed, error)

		expect(dlqService.handleFailedJob).toHaveBeenCalledWith(failed, error)
	})
})
