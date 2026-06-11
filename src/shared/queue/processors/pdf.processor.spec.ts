/**
 * PdfProcessor unit tests — see image.processor.spec for rationale.
 */
import { getQueueToken } from '@nestjs/bullmq'
import { Test } from '@nestjs/testing'
import type { Job } from 'bullmq'
import { DlqService } from '../dlq.service'
import { QUEUE_NAMES } from '../queue.constants'
import { PdfProcessor } from './pdf.processor'

const dlqServiceMock = { handleFailedJob: jest.fn() }
const makeJob = (name: string): Job =>
	({ id: 'j1', name, data: { outputPath: '/out.pdf' }, attemptsMade: 1 }) as unknown as Job

describe('PdfProcessor', () => {
	let processor: PdfProcessor

	beforeEach(async () => {
		const module = await Test.createTestingModule({
			providers: [
				PdfProcessor,
				{ provide: DlqService, useValue: dlqServiceMock },
				{ provide: getQueueToken(QUEUE_NAMES.DEAD_LETTER), useValue: { add: jest.fn() } },
			],
		}).compile()
		processor = module.get(PdfProcessor)
		jest.clearAllMocks()
	})

	it('throws "not implemented" for any job (until real impl lands)', async () => {
		await expect(processor.process(makeJob('invoice'))).rejects.toThrow(/not yet implemented/)
	})

	it('onFailed → routes to DLQ', async () => {
		const job = makeJob('invoice')
		const error = new Error('boom')
		await processor.onFailed(job, error)
		expect(dlqServiceMock.handleFailedJob).toHaveBeenCalledWith(job, error)
	})
})
