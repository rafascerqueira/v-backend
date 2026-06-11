/**
 * DeadLetterProcessor unit tests
 *
 * The DLQ processor just logs at error level. The log format is the only
 * forensic trail when something fails for good — pin it so an ops change to
 * the message doesn't accidentally drop fields that we grep for in logs.
 */
import { getQueueToken } from '@nestjs/bullmq'
import { Logger } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import type { Job } from 'bullmq'
import { QUEUE_NAMES } from '../queue.constants'
import type { DeadLetterJobData } from '../queue.types'
import { DeadLetterProcessor } from './dead-letter.processor'

describe('DeadLetterProcessor', () => {
	let processor: DeadLetterProcessor
	let errorSpy: jest.SpyInstance

	beforeEach(async () => {
		const module = await Test.createTestingModule({
			providers: [
				DeadLetterProcessor,
				{ provide: getQueueToken(QUEUE_NAMES.DEAD_LETTER), useValue: { add: jest.fn() } },
			],
		}).compile()

		processor = module.get(DeadLetterProcessor)
		errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
	})

	afterEach(() => {
		jest.restoreAllMocks()
	})

	it('logs an error line containing all forensically-useful fields', async () => {
		const data: DeadLetterJobData = {
			originalQueue: 'email',
			originalJobName: 'send',
			originalJobId: 'job-42',
			attemptsMade: 3,
			failedReason: 'smtp timeout',
			failedAt: '2026-06-04T18:00:00Z',
			originalData: { foo: 'bar' },
		}
		const job = { id: 'dlq-1', name: 'dead-letter', data } as unknown as Job<DeadLetterJobData>

		await processor.process(job)

		expect(errorSpy).toHaveBeenCalledTimes(1)
		const message = errorSpy.mock.calls[0][0] as string
		expect(message).toContain('queue="email"')
		expect(message).toContain('job="send"')
		expect(message).toContain('id="job-42"')
		expect(message).toContain('attempts=3')
		expect(message).toContain('reason="smtp timeout"')
		expect(message).toContain('failedAt=2026-06-04T18:00:00Z')
	})
})
