/**
 * AdminController unit tests
 * Covers: all admin-only endpoints — stats, accounts, logs, health
 * Guards mocked: JwtAuthGuard, RolesGuard
 */

import { Test } from '@nestjs/testing'
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard'
import { RolesGuard } from '@/modules/auth/guards/roles.guard'
import { AdminService } from '../services/admin.service'
import { AdminController } from './admin.controller'

const serviceMock = {
	getStats: jest.fn(),
	getSubscriptionStats: jest.fn(),
	getAccounts: jest.fn(),
	getAccountById: jest.fn(),
	getAccountUsage: jest.fn(),
	updateAccount: jest.fn(),
	updateAccountPlan: jest.fn(),
	suspendAccount: jest.fn(),
	resetUserPassword: jest.fn(),
	disable2FA: jest.fn(),
	getActiveUsers: jest.fn(),
	getAuditLogs: jest.fn(),
	getSystemHealth: jest.fn(),
	createAccount: jest.fn(),
	deleteAccount: jest.fn(),
}

function makeRequest(sub = 'admin-uuid-1') {
	return { user: { sub } }
}

describe('AdminController', () => {
	let controller: AdminController

	beforeEach(async () => {
		const module = await Test.createTestingModule({
			controllers: [AdminController],
			providers: [{ provide: AdminService, useValue: serviceMock }],
		})
			.overrideGuard(JwtAuthGuard)
			.useValue({ canActivate: () => true })
			.overrideGuard(RolesGuard)
			.useValue({ canActivate: () => true })
			.compile()

		controller = module.get(AdminController)
		jest.clearAllMocks()
	})

	describe('getStats', () => {
		it('should return system statistics', async () => {
			const stats = { totalAccounts: 100, activeAccounts: 80 }
			serviceMock.getStats.mockResolvedValueOnce(stats)

			const result = await controller.getStats()

			expect(serviceMock.getStats).toHaveBeenCalled()
			expect(result).toEqual(stats)
		})
	})

	describe('getSubscriptionStats', () => {
		it('should return subscription statistics', async () => {
			const stats = { free: 50, pro: 30, enterprise: 20 }
			serviceMock.getSubscriptionStats.mockResolvedValueOnce(stats)

			const result = await controller.getSubscriptionStats()

			expect(result).toEqual(stats)
		})
	})

	describe('getAccounts', () => {
		it('should call service with default page/limit when no params provided', async () => {
			const accounts = { data: [], total: 0 }
			serviceMock.getAccounts.mockResolvedValueOnce(accounts)

			const result = await controller.getAccounts()

			expect(serviceMock.getAccounts).toHaveBeenCalledWith(1, 20, {
				role: undefined,
				plan: undefined,
				search: undefined,
			})
			expect(result).toEqual(accounts)
		})

		it('should parse page and limit as integers', async () => {
			serviceMock.getAccounts.mockResolvedValueOnce({ data: [], total: 0 })

			await controller.getAccounts('3', '50', 'seller', 'pro', 'test')

			expect(serviceMock.getAccounts).toHaveBeenCalledWith(3, 50, {
				role: 'seller',
				plan: 'pro',
				search: 'test',
			})
		})
	})

	describe('getAccountById', () => {
		it('should return account details for the given id', async () => {
			const account = { id: 'acc-1', name: 'Test User' }
			serviceMock.getAccountById.mockResolvedValueOnce(account)

			const result = await controller.getAccountById('acc-1')

			expect(serviceMock.getAccountById).toHaveBeenCalledWith('acc-1')
			expect(result).toEqual(account)
		})
	})

	describe('getAccountUsage', () => {
		it('should return usage for the given account', async () => {
			const usage = { products: 10, orders: 5 }
			serviceMock.getAccountUsage.mockResolvedValueOnce(usage)

			const result = await controller.getAccountUsage('acc-1')

			expect(serviceMock.getAccountUsage).toHaveBeenCalledWith('acc-1')
			expect(result).toEqual(usage)
		})
	})

	describe('updateAccountPlan', () => {
		it('should update account plan and return result', async () => {
			const updated = { id: 'acc-1', plan: 'pro' }
			serviceMock.updateAccountPlan.mockResolvedValueOnce(updated)

			const result = await controller.updateAccountPlan('acc-1', 'pro' as any, makeRequest())

			expect(serviceMock.updateAccountPlan).toHaveBeenCalledWith('acc-1', 'pro', 'admin-uuid-1')
			expect(result).toEqual(updated)
		})
	})

	describe('suspendAccount', () => {
		it('should suspend account and return result', async () => {
			const suspended = { id: 'acc-1', suspended: true }
			serviceMock.suspendAccount.mockResolvedValueOnce(suspended)

			const result = await controller.suspendAccount('acc-1', 'Violação dos termos', makeRequest())

			expect(serviceMock.suspendAccount).toHaveBeenCalledWith(
				'acc-1',
				'Violação dos termos',
				'admin-uuid-1',
			)
			expect(result).toEqual(suspended)
		})
	})

	describe('resetUserPassword', () => {
		it('should generate password reset token', async () => {
			const token = { resetToken: 'abc123' }
			serviceMock.resetUserPassword.mockResolvedValueOnce(token)

			const result = await controller.resetUserPassword('acc-1', makeRequest())

			expect(serviceMock.resetUserPassword).toHaveBeenCalledWith('acc-1', 'admin-uuid-1')
			expect(result).toEqual(token)
		})
	})

	describe('disable2FA', () => {
		it('should disable 2FA for given account', async () => {
			serviceMock.disable2FA.mockResolvedValueOnce({ success: true })

			const result = await controller.disable2FA('acc-1', makeRequest())

			expect(serviceMock.disable2FA).toHaveBeenCalledWith('acc-1', 'admin-uuid-1')
			expect(result).toEqual({ success: true })
		})
	})

	describe('getActiveUsers', () => {
		it('should return active users list', async () => {
			const users = [{ id: 'u1' }, { id: 'u2' }]
			serviceMock.getActiveUsers.mockResolvedValueOnce(users)

			const result = await controller.getActiveUsers()

			expect(serviceMock.getActiveUsers).toHaveBeenCalled()
			expect(result).toEqual(users)
		})
	})

	describe('getLogs', () => {
		it('should call service with default pagination when no params', async () => {
			const logs = { data: [], total: 0 }
			serviceMock.getAuditLogs.mockResolvedValueOnce(logs)

			const result = await controller.getLogs()

			expect(serviceMock.getAuditLogs).toHaveBeenCalledWith(1, 50, {
				entity: undefined,
				action: undefined,
			})
			expect(result).toEqual(logs)
		})

		it('should parse page and limit as integers with filters', async () => {
			serviceMock.getAuditLogs.mockResolvedValueOnce({ data: [], total: 0 })

			await controller.getLogs('2', '25', 'product', 'create')

			expect(serviceMock.getAuditLogs).toHaveBeenCalledWith(2, 25, {
				entity: 'product',
				action: 'create',
			})
		})
	})

	describe('getHealth', () => {
		it('should return system health status', async () => {
			const health = { database: 'ok', memory: 'ok' }
			serviceMock.getSystemHealth.mockResolvedValueOnce(health)

			const result = await controller.getHealth()

			expect(serviceMock.getSystemHealth).toHaveBeenCalled()
			expect(result).toEqual(health)
		})
	})

	describe('updateAccount', () => {
		it('should call service.updateAccount with id, fields, and admin sub', async () => {
			const updated = { id: 'acc-1', name: 'New Name', email: 'new@email.com' }
			serviceMock.updateAccount.mockResolvedValueOnce(updated)

			const result = await controller.updateAccount(
				'acc-1',
				{ name: 'New Name', email: 'new@email.com', role: 'seller', plan_type: 'pro' },
				makeRequest(),
			)

			expect(serviceMock.updateAccount).toHaveBeenCalledWith(
				'acc-1',
				{ name: 'New Name', email: 'new@email.com', role: 'seller', plan_type: 'pro' },
				'admin-uuid-1',
			)
			expect(result).toEqual(updated)
		})

		it('should propagate NotFoundException when account not found', async () => {
			const { NotFoundException } = await import('@nestjs/common')
			serviceMock.updateAccount.mockRejectedValueOnce(new NotFoundException('Conta não encontrada'))

			await expect(
				controller.updateAccount('unknown', { name: 'X' }, makeRequest()),
			).rejects.toThrow(NotFoundException)
		})
	})

	describe('createAccount', () => {
		it('should call service.createAccount with body fields and admin sub', async () => {
			const created = { id: 'new-acc', name: 'Loja Nova', email: 'loja@ex.com', plan_type: 'free' }
			serviceMock.createAccount.mockResolvedValueOnce(created)

			const result = await controller.createAccount(
				{ name: 'Loja Nova', email: 'loja@ex.com', password: 'S3cret!', plan_type: 'free' },
				makeRequest(),
			)

			expect(serviceMock.createAccount).toHaveBeenCalledWith({
				name: 'Loja Nova',
				email: 'loja@ex.com',
				password: 'S3cret!',
				plan_type: 'free',
				adminId: 'admin-uuid-1',
			})
			expect(result).toEqual(created)
		})

		it('should propagate ConflictException on duplicate email', async () => {
			const { ConflictException } = await import('@nestjs/common')
			serviceMock.createAccount.mockRejectedValueOnce(new ConflictException('Email already in use'))

			await expect(
				controller.createAccount({ name: 'X', email: 'dup@ex.com', password: 'pw' }, makeRequest()),
			).rejects.toThrow(ConflictException)
		})
	})

	describe('deleteAccount', () => {
		it('should call service.deleteAccount with id and admin sub', async () => {
			serviceMock.deleteAccount.mockResolvedValueOnce(undefined)

			await controller.deleteAccount('acc-1', makeRequest())

			expect(serviceMock.deleteAccount).toHaveBeenCalledWith('acc-1', 'admin-uuid-1')
		})

		it('should propagate NotFoundException when account not found', async () => {
			const { NotFoundException } = await import('@nestjs/common')
			serviceMock.deleteAccount.mockRejectedValueOnce(new NotFoundException('Conta não encontrada'))

			await expect(controller.deleteAccount('unknown', makeRequest())).rejects.toThrow(
				NotFoundException,
			)
		})
	})
})
