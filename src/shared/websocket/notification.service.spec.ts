import { Test } from '@nestjs/testing'
import { PrismaService } from '@/shared/prisma/prisma.service'
import { QueueProducer } from '@/shared/queue/queue.producer'
import { NotificationService } from './notification.service'
import { NotificationsGateway } from './notifications.gateway'

const prismaMock = {
	notification: {
		create: jest.fn(),
		update: jest.fn(),
		updateMany: jest.fn(),
		count: jest.fn(),
		findMany: jest.fn(),
	},
	account: {
		findUnique: jest.fn(),
	},
}

const gatewayMock = { sendToUser: jest.fn() }

const queueProducerMock = { sendEmail: jest.fn() }

const baseNotification = {
	id: 1,
	createdAt: new Date('2024-01-01'),
}

describe('NotificationService', () => {
	let service: NotificationService

	beforeEach(async () => {
		const module = await Test.createTestingModule({
			providers: [
				NotificationService,
				{ provide: PrismaService, useValue: prismaMock },
				{ provide: NotificationsGateway, useValue: gatewayMock },
				{ provide: QueueProducer, useValue: queueProducerMock },
			],
		}).compile()

		service = module.get(NotificationService)
		jest.clearAllMocks()
	})

	describe('create', () => {
		it('persists notification, emits WebSocket, and returns ws notification', async () => {
			prismaMock.notification.create.mockResolvedValueOnce({ ...baseNotification })

			const result = await service.create({
				userId: 'u1',
				type: 'info',
				title: 'Test',
				message: 'Hello',
			})

			expect(prismaMock.notification.create).toHaveBeenCalledWith({
				data: expect.objectContaining({ user_id: 'u1', title: 'Test', email_sent: false }),
			})
			expect(gatewayMock.sendToUser).toHaveBeenCalledWith(
				'u1',
				expect.objectContaining({ title: 'Test' }),
			)
			expect(result.id).toBe('notif-1')
			expect(result.read).toBe(false)
		})

		it('does not enqueue email when sendEmail is false', async () => {
			prismaMock.notification.create.mockResolvedValueOnce({ ...baseNotification })

			await service.create({ userId: 'u1', type: 'info', title: 'T', message: 'M' })

			expect(queueProducerMock.sendEmail).not.toHaveBeenCalled()
		})

		it('enqueues email when sendEmail is true and user exists', async () => {
			prismaMock.notification.create.mockResolvedValueOnce({ ...baseNotification })
			prismaMock.account.findUnique.mockResolvedValueOnce({ email: 'u@test.com', name: 'Ana' })

			await service.create({
				userId: 'u1',
				type: 'success',
				title: 'Order placed',
				message: 'Your order is confirmed',
				sendEmail: true,
				emailSubject: 'Order confirmed',
			})

			// sendEmailNotification is fire-and-forget; wait for microtasks
			await Promise.resolve()

			expect(queueProducerMock.sendEmail).toHaveBeenCalledWith(
				expect.objectContaining({ to: 'u@test.com', subject: 'Order confirmed' }),
			)
		})

		it('does not enqueue email when user is not found', async () => {
			prismaMock.notification.create.mockResolvedValueOnce({ ...baseNotification })
			prismaMock.account.findUnique.mockResolvedValueOnce(null)

			await service.create({
				userId: 'ghost',
				type: 'info',
				title: 'T',
				message: 'M',
				sendEmail: true,
			})

			await Promise.resolve()

			expect(queueProducerMock.sendEmail).not.toHaveBeenCalled()
		})

		it('uses title as email subject when emailSubject is not provided', async () => {
			prismaMock.notification.create.mockResolvedValueOnce({ ...baseNotification })
			prismaMock.account.findUnique.mockResolvedValueOnce({ email: 'u@test.com', name: 'Ana' })

			await service.create({
				userId: 'u1',
				type: 'warning',
				title: 'Low stock',
				message: 'Only 2 left',
				sendEmail: true,
			})

			await Promise.resolve()

			expect(queueProducerMock.sendEmail).toHaveBeenCalledWith(
				expect.objectContaining({ subject: 'Low stock' }),
			)
		})
	})
})
