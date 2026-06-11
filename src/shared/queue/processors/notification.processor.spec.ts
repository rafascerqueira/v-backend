/**
 * NotificationProcessor unit tests
 *
 * Validates the two contracts that matter for in-app notifications:
 *  1. The job's `data` payload is passed verbatim to NotificationService.create
 *  2. Failures are routed to the DLQ (so we don't lose notification jobs
 *     silently when WebSocket / DB is down)
 */
import { getQueueToken } from '@nestjs/bullmq'
import { Test } from '@nestjs/testing'
import type { Job } from 'bullmq'
import { NotificationService } from '@/shared/websocket/notification.service'
import { DlqService } from '../dlq.service'
import { QUEUE_NAMES } from '../queue.constants'
import { NotificationProcessor } from './notification.processor'

const notificationServiceMock = { create: jest.fn().mockResolvedValue(undefined) }
const dlqServiceMock = { handleFailedJob: jest.fn() }

const makeJob = (data: object): Job =>
	({ id: 'j1', name: 'notify', data, attemptsMade: 1 }) as unknown as Job

describe('NotificationProcessor', () => {
	let processor: NotificationProcessor

	beforeEach(async () => {
		const module = await Test.createTestingModule({
			providers: [
				NotificationProcessor,
				{ provide: NotificationService, useValue: notificationServiceMock },
				{ provide: DlqService, useValue: dlqServiceMock },
				{ provide: getQueueToken(QUEUE_NAMES.DEAD_LETTER), useValue: { add: jest.fn() } },
			],
		}).compile()

		processor = module.get(NotificationProcessor)
		jest.clearAllMocks()
	})

	it('process → forwards the job payload to NotificationService.create', async () => {
		const data = { user_id: 'u1', type: 'order.created', title: 'Novo pedido', body: '...' }
		await processor.process(makeJob(data))
		expect(notificationServiceMock.create).toHaveBeenCalledWith(data)
	})

	it('onFailed → delegates to DlqService.handleFailedJob (no silent loss)', async () => {
		const job = makeJob({ user_id: 'u1' })
		const error = new Error('ws gateway unreachable')
		await processor.onFailed(job, error)
		expect(dlqServiceMock.handleFailedJob).toHaveBeenCalledWith(job, error)
	})
})
