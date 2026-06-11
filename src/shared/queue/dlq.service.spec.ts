import { getQueueToken } from '@nestjs/bullmq'
import { Test } from '@nestjs/testing'
import type { Job } from 'bullmq'
import { DlqService } from './dlq.service'
import { QUEUE_NAMES } from './queue.constants'

const dlqMock = { add: jest.fn() }

const makeJob = (overrides: Partial<Job> = {}): Job =>
	({
		id: 'job-1',
		name: 'send',
		queueName: QUEUE_NAMES.EMAIL,
		data: { to: 'a@b.com' },
		opts: { attempts: 3 },
		attemptsMade: 3,
		...overrides,
	}) as unknown as Job

describe('DlqService', () => {
	let service: DlqService

	beforeEach(async () => {
		const module = await Test.createTestingModule({
			providers: [
				DlqService,
				{ provide: getQueueToken(QUEUE_NAMES.DEAD_LETTER), useValue: dlqMock },
			],
		}).compile()

		service = module.get(DlqService)
		jest.clearAllMocks()
	})

	it('routes job to DLQ when attempts are exhausted', async () => {
		const job = makeJob({ attemptsMade: 3, opts: { attempts: 3 } })
		await service.handleFailedJob(job, new Error('smtp timeout'))

		expect(dlqMock.add).toHaveBeenCalledTimes(1)
		const [name, payload] = dlqMock.add.mock.calls[0]
		expect(name).toBe('dlq')
		expect(payload.originalQueue).toBe(QUEUE_NAMES.EMAIL)
		expect(payload.originalJobId).toBe('job-1')
		expect(payload.originalJobName).toBe('send')
		expect(payload.failedReason).toBe('smtp timeout')
		expect(payload.attemptsMade).toBe(3)
		expect(typeof payload.failedAt).toBe('string')
	})

	it('does not route to DLQ when retries remain', async () => {
		const job = makeJob({ attemptsMade: 1, opts: { attempts: 3 } })
		await service.handleFailedJob(job, new Error('transient'))

		expect(dlqMock.add).not.toHaveBeenCalled()
	})

	it('treats missing opts.attempts as maxAttempts=1', async () => {
		const job = makeJob({ attemptsMade: 1, opts: {} })
		await service.handleFailedJob(job, new Error('boom'))

		expect(dlqMock.add).toHaveBeenCalledTimes(1)
	})

	it('falls back to "unknown" when job has no id', async () => {
		const job = makeJob({ id: undefined, attemptsMade: 3, opts: { attempts: 3 } })
		await service.handleFailedJob(job, new Error('no id'))

		const payload = dlqMock.add.mock.calls[0][1]
		expect(payload.originalJobId).toBe('unknown')
	})
})
