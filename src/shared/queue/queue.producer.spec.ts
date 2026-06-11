import { getQueueToken } from '@nestjs/bullmq'
import { Test } from '@nestjs/testing'
import { EMAIL_JOBS, IMAGE_JOBS, QUEUE_NAMES } from './queue.constants'
import { QueueProducer } from './queue.producer'

const makeQueueMock = () => ({ add: jest.fn() })

describe('QueueProducer', () => {
	let producer: QueueProducer
	let emailQueue: ReturnType<typeof makeQueueMock>
	let notificationQueue: ReturnType<typeof makeQueueMock>
	let pdfQueue: ReturnType<typeof makeQueueMock>
	let imageQueue: ReturnType<typeof makeQueueMock>
	let excelQueue: ReturnType<typeof makeQueueMock>

	beforeEach(async () => {
		emailQueue = makeQueueMock()
		notificationQueue = makeQueueMock()
		pdfQueue = makeQueueMock()
		imageQueue = makeQueueMock()
		excelQueue = makeQueueMock()

		const module = await Test.createTestingModule({
			providers: [
				QueueProducer,
				{ provide: getQueueToken(QUEUE_NAMES.EMAIL), useValue: emailQueue },
				{ provide: getQueueToken(QUEUE_NAMES.NOTIFICATION), useValue: notificationQueue },
				{ provide: getQueueToken(QUEUE_NAMES.PDF), useValue: pdfQueue },
				{ provide: getQueueToken(QUEUE_NAMES.IMAGE), useValue: imageQueue },
				{ provide: getQueueToken(QUEUE_NAMES.EXCEL), useValue: excelQueue },
			],
		}).compile()

		producer = module.get(QueueProducer)
	})

	describe('email', () => {
		it('sendEmail enqueues with job name "send"', async () => {
			const data = { to: 'a@b.com', subject: 'Hi', html: '<p>Hi</p>' }
			await producer.sendEmail(data)
			expect(emailQueue.add).toHaveBeenCalledWith(EMAIL_JOBS.SEND, data)
		})

		it('sendPasswordResetEmail enqueues with correct job name', async () => {
			const data = { to: 'a@b.com', name: 'Ana', token: 'tok' }
			await producer.sendPasswordResetEmail(data)
			expect(emailQueue.add).toHaveBeenCalledWith(EMAIL_JOBS.PASSWORD_RESET, data)
		})

		it('sendEmailVerification enqueues with correct job name', async () => {
			const data = { to: 'a@b.com', name: 'Ana', token: 'tok' }
			await producer.sendEmailVerification(data)
			expect(emailQueue.add).toHaveBeenCalledWith(EMAIL_JOBS.VERIFY_EMAIL, data)
		})

		it('sendWelcomeEmail enqueues with correct job name', async () => {
			const data = { to: 'a@b.com', name: 'Ana' }
			await producer.sendWelcomeEmail(data)
			expect(emailQueue.add).toHaveBeenCalledWith(EMAIL_JOBS.WELCOME, data)
		})
	})

	describe('notification', () => {
		it('createNotification enqueues to notification queue', async () => {
			const data = { userId: 'u1', type: 'info' as const, title: 'T', message: 'M' }
			await producer.createNotification(data)
			expect(notificationQueue.add).toHaveBeenCalledWith('create', data)
		})
	})

	describe('pdf', () => {
		it('generatePdf enqueues with given job name', async () => {
			const data = { type: 'invoice', data: {}, outputPath: '/tmp/out.pdf' }
			await producer.generatePdf('invoice', data)
			expect(pdfQueue.add).toHaveBeenCalledWith('invoice', data)
		})
	})

	describe('image', () => {
		it('resizeImage enqueues with job name "resize"', async () => {
			const data = { inputPath: '/in.jpg', outputPath: '/out.jpg', width: 100 }
			await producer.resizeImage(data)
			expect(imageQueue.add).toHaveBeenCalledWith(IMAGE_JOBS.RESIZE, data)
		})

		it('compressImage enqueues with job name "compress"', async () => {
			const data = { inputPath: '/in.jpg', outputPath: '/out.jpg' }
			await producer.compressImage(data)
			expect(imageQueue.add).toHaveBeenCalledWith(IMAGE_JOBS.COMPRESS, data)
		})

		it('generateThumbnail enqueues with job name "thumbnail"', async () => {
			const data = { inputPath: '/in.jpg', outputPath: '/thumb.jpg' }
			await producer.generateThumbnail(data)
			expect(imageQueue.add).toHaveBeenCalledWith(IMAGE_JOBS.THUMBNAIL, data)
		})
	})

	describe('excel', () => {
		it('generateExcel enqueues with given job name', async () => {
			const data = { type: 'sales', data: [], outputPath: '/tmp/out.xlsx' }
			await producer.generateExcel('sales-report', data)
			expect(excelQueue.add).toHaveBeenCalledWith('sales-report', data)
		})
	})
})
