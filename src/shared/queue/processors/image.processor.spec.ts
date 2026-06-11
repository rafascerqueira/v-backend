/**
 * ImageProcessor unit tests
 *
 * Stub processor (job bodies are TODO). Only what matters now:
 *  - jobs throw instead of silently completing (would mark them done in BullMQ
 *    and we'd lose the fact that nothing happened)
 *  - onFailed routes to the DLQ (regression guard — if someone refactors and
 *    forgets the DLQ wiring, image jobs would die silently after retries)
 */
import { getQueueToken } from '@nestjs/bullmq'
import { Test } from '@nestjs/testing'
import type { Job } from 'bullmq'
import { DlqService } from '../dlq.service'
import { IMAGE_JOBS, QUEUE_NAMES } from '../queue.constants'
import { ImageProcessor } from './image.processor'

const dlqServiceMock = { handleFailedJob: jest.fn() }
const makeJob = (name: string): Job =>
	({
		id: 'j1',
		name,
		data: { inputPath: '/in', outputPath: '/out' },
		attemptsMade: 1,
	}) as unknown as Job

describe('ImageProcessor', () => {
	let processor: ImageProcessor

	beforeEach(async () => {
		const module = await Test.createTestingModule({
			providers: [
				ImageProcessor,
				{ provide: DlqService, useValue: dlqServiceMock },
				{ provide: getQueueToken(QUEUE_NAMES.DEAD_LETTER), useValue: { add: jest.fn() } },
			],
		}).compile()
		processor = module.get(ImageProcessor)
		jest.clearAllMocks()
	})

	it('throws "not implemented" for known job types (until real impl lands)', async () => {
		await expect(processor.process(makeJob(IMAGE_JOBS.RESIZE))).rejects.toThrow(
			/not yet implemented/,
		)
		await expect(processor.process(makeJob(IMAGE_JOBS.COMPRESS))).rejects.toThrow(
			/not yet implemented/,
		)
		await expect(processor.process(makeJob(IMAGE_JOBS.THUMBNAIL))).rejects.toThrow(
			/not yet implemented/,
		)
	})

	it('throws on unknown job name (defensive)', async () => {
		await expect(processor.process(makeJob('mystery'))).rejects.toThrow(/Unknown image job/)
	})

	it('onFailed → routes to DLQ', async () => {
		const job = makeJob(IMAGE_JOBS.RESIZE)
		const error = new Error('boom')
		await processor.onFailed(job, error)
		expect(dlqServiceMock.handleFailedJob).toHaveBeenCalledWith(job, error)
	})
})
