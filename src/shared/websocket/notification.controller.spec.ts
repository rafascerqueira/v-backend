/**
 * NotificationController unit tests
 * Covers: GET /notifications, GET /notifications/unread-count,
 *         PATCH /notifications/:id/read, PATCH /notifications/read-all
 * Guards mocked: JwtAuthGuard
 */

import { Test } from '@nestjs/testing'
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard'
import { NotificationController } from './notification.controller'
import { NotificationService } from './notification.service'

const serviceMock = {
	getAll: jest.fn(),
	getUnreadCount: jest.fn(),
	markAsRead: jest.fn(),
	markAllAsRead: jest.fn(),
}

function makeRequest(sub = 'user-uuid-1') {
	return { user: { sub } }
}

describe('NotificationController', () => {
	let controller: NotificationController

	beforeEach(async () => {
		const module = await Test.createTestingModule({
			controllers: [NotificationController],
			providers: [{ provide: NotificationService, useValue: serviceMock }],
		})
			.overrideGuard(JwtAuthGuard)
			.useValue({ canActivate: () => true })
			.compile()

		controller = module.get(NotificationController)
		jest.clearAllMocks()
	})

	describe('getAll', () => {
		it('should return notifications with default limit of 50', async () => {
			const notifications = [{ id: 'n1', message: 'Hello' }]
			serviceMock.getAll.mockResolvedValueOnce(notifications)

			const result = await controller.getAll(makeRequest())

			expect(serviceMock.getAll).toHaveBeenCalledWith('user-uuid-1', 50)
			expect(result).toEqual(notifications)
		})

		it('should parse limit query param as integer', async () => {
			serviceMock.getAll.mockResolvedValueOnce([])

			await controller.getAll(makeRequest(), '20')

			expect(serviceMock.getAll).toHaveBeenCalledWith('user-uuid-1', 20)
		})
	})

	describe('getUnreadCount', () => {
		it('should return unread notification count', async () => {
			serviceMock.getUnreadCount.mockResolvedValueOnce(3)

			const result = await controller.getUnreadCount(makeRequest())

			expect(serviceMock.getUnreadCount).toHaveBeenCalledWith('user-uuid-1')
			expect(result).toEqual({ count: 3 })
		})
	})

	describe('markAsRead', () => {
		it('should mark a notification as read and return success', async () => {
			serviceMock.markAsRead.mockResolvedValueOnce(undefined)

			const result = await controller.markAsRead(makeRequest(), 'notif-uuid-1')

			expect(serviceMock.markAsRead).toHaveBeenCalledWith('user-uuid-1', 'notif-uuid-1')
			expect(result).toEqual({ success: true })
		})
	})

	describe('markAllAsRead', () => {
		it('should mark all notifications as read and return success', async () => {
			serviceMock.markAllAsRead.mockResolvedValueOnce(undefined)

			const result = await controller.markAllAsRead(makeRequest())

			expect(serviceMock.markAllAsRead).toHaveBeenCalledWith('user-uuid-1')
			expect(result).toEqual({ success: true })
		})
	})
})
