import { getQueueToken } from '@nestjs/bullmq'
import { Test } from '@nestjs/testing'
import type { Job } from 'bullmq'
import { EmailService } from '@/shared/email/email.service'
import { DlqService } from '../dlq.service'
import { EMAIL_JOBS, QUEUE_NAMES } from '../queue.constants'
import { EmailProcessor } from './email.processor'

const emailServiceMock = {
	sendEmail: jest.fn().mockResolvedValue(true),
	sendPasswordResetEmail: jest.fn().mockResolvedValue(true),
	sendEmailVerification: jest.fn().mockResolvedValue(true),
	sendWelcomeEmail: jest.fn().mockResolvedValue(true),
}

const dlqServiceMock = { handleFailedJob: jest.fn() }

const makeJob = (name: string, data: object): Job =>
	({ id: 'j1', name, data, opts: { attempts: 3 }, attemptsMade: 1 }) as unknown as Job

describe('EmailProcessor', () => {
	let processor: EmailProcessor

	beforeEach(async () => {
		const module = await Test.createTestingModule({
			providers: [
				EmailProcessor,
				{ provide: EmailService, useValue: emailServiceMock },
				{ provide: DlqService, useValue: dlqServiceMock },
				{ provide: getQueueToken(QUEUE_NAMES.DEAD_LETTER), useValue: { add: jest.fn() } },
			],
		}).compile()

		processor = module.get(EmailProcessor)
		jest.clearAllMocks()
	})

	it('send → calls emailService.sendEmail with correct args', async () => {
		const data = { to: 'a@b.com', subject: 'S', html: '<p>H</p>', text: 'H' }
		await processor.process(makeJob(EMAIL_JOBS.SEND, data))

		expect(emailServiceMock.sendEmail).toHaveBeenCalledWith({
			to: data.to,
			subject: data.subject,
			html: data.html,
			text: data.text,
		})
	})

	it('password-reset → calls sendPasswordResetEmail', async () => {
		const data = { to: 'a@b.com', name: 'Ana', token: 'tok' }
		await processor.process(makeJob(EMAIL_JOBS.PASSWORD_RESET, data))

		expect(emailServiceMock.sendPasswordResetEmail).toHaveBeenCalledWith(
			data.to,
			data.token,
			data.name,
		)
	})

	it('verify-email → calls sendEmailVerification', async () => {
		const data = { to: 'a@b.com', name: 'Ana', token: 'tok' }
		await processor.process(makeJob(EMAIL_JOBS.VERIFY_EMAIL, data))

		expect(emailServiceMock.sendEmailVerification).toHaveBeenCalledWith(
			data.to,
			data.token,
			data.name,
		)
	})

	it('welcome → calls sendWelcomeEmail', async () => {
		const data = { to: 'a@b.com', name: 'Ana' }
		await processor.process(makeJob(EMAIL_JOBS.WELCOME, data))

		expect(emailServiceMock.sendWelcomeEmail).toHaveBeenCalledWith(data.to, data.name)
	})

	it('unknown job name → does not call any email method', async () => {
		await processor.process(makeJob('unknown-job', {}))

		expect(emailServiceMock.sendEmail).not.toHaveBeenCalled()
		expect(emailServiceMock.sendPasswordResetEmail).not.toHaveBeenCalled()
		expect(emailServiceMock.sendEmailVerification).not.toHaveBeenCalled()
		expect(emailServiceMock.sendWelcomeEmail).not.toHaveBeenCalled()
	})

	it('onFailed → delegates to DlqService', async () => {
		const job = makeJob(EMAIL_JOBS.SEND, {})
		const error = new Error('smtp down')
		await processor.onFailed(job, error)

		expect(dlqServiceMock.handleFailedJob).toHaveBeenCalledWith(job, error)
	})
})
