/**
 * AdminService unit tests
 * Covers: getStats, getAccounts, getAccountById, updateAccountPlan, suspendAccount,
 *         resetUserPassword, disable2FA, getAccountUsage, getActiveUsers, getSubscriptionStats,
 *         getAuditLogs, getSystemHealth, createAccount, deleteAccount
 * Verifies: not-found errors, admin-protection rules, audit log creation, growth calculations
 */
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { Prisma } from '@/generated/prisma/client'
import { PasswordHasherService } from '@/shared/crypto/password-hasher.service'
import { ADMIN_REPOSITORY, type AdminRepository } from '@/shared/repositories/admin.repository'
import { AdminService } from './admin.service'

const repositoryMock: jest.Mocked<AdminRepository> = {
	getStats: jest.fn(),
	findAccounts: jest.fn(),
	findAccountById: jest.fn(),
	findAccountBasicInfo: jest.fn(),
	updateAccountPlan: jest.fn(),
	createAuditLog: jest.fn(),
	cancelActiveSubscriptions: jest.fn(),
	updateAccount: jest.fn(),
	createPasswordResetToken: jest.fn(),
	getAccountUsageCounts: jest.fn(),
	findActiveUsers: jest.fn(),
	getSubscriptionStats: jest.fn(),
	findAuditLogs: jest.fn(),
	checkDatabaseHealth: jest.fn(),
	createAccount: jest.fn(),
	deleteAccount: jest.fn(),
}

const passwordHasherMock = {
	hash: jest.fn().mockResolvedValue({ hash: 'hashed', salt: 'salt' }),
	verify: jest.fn(),
}

describe('AdminService', () => {
	let service: AdminService

	beforeEach(async () => {
		const module = await Test.createTestingModule({
			providers: [
				AdminService,
				{ provide: ADMIN_REPOSITORY, useValue: repositoryMock },
				{ provide: PasswordHasherService, useValue: passwordHasherMock },
			],
		}).compile()

		service = module.get(AdminService)
		jest.clearAllMocks()
	})

	describe('getStats', () => {
		it('should compute revenue and orders growth and return formatted stats', async () => {
			repositoryMock.getStats.mockResolvedValueOnce({
				totalAccounts: 100,
				totalCustomers: 200,
				totalProducts: 50,
				totalOrders: 300,
				ordersToday: 10,
				ordersThisMonth: 50,
				ordersLastMonth: 40,
				revenueThisMonth: 10000,
				revenueLastMonth: 8000,
				pendingOrders: 5,
				activeProducts: 45,
			})

			const result = await service.getStats()

			expect(result.accounts.total).toBe(100)
			expect(result.orders.thisMonth).toBe(50)
			expect(result.revenue.growth).toBeCloseTo(25, 0) // (10000-8000)/8000 * 100
			expect(result.orders.growth).toBeCloseTo(25, 0)
		})

		it('should return 0 growth when previous period had no data', async () => {
			repositoryMock.getStats.mockResolvedValueOnce({
				totalAccounts: 10,
				totalCustomers: 20,
				totalProducts: 5,
				totalOrders: 30,
				ordersToday: 1,
				ordersThisMonth: 5,
				ordersLastMonth: 0,
				revenueThisMonth: 1000,
				revenueLastMonth: null,
				pendingOrders: 0,
				activeProducts: 4,
			})

			const result = await service.getStats()

			expect(result.revenue.growth).toBe(0)
			expect(result.orders.growth).toBe(0)
		})
	})

	describe('getAccounts', () => {
		it('should return paginated accounts with meta', async () => {
			repositoryMock.findAccounts.mockResolvedValueOnce({ data: [{ id: 'a1' }] as any, total: 1 })

			const result = await service.getAccounts(1, 20)

			expect(result.data).toHaveLength(1)
			expect(result.meta.total).toBe(1)
			expect(result.meta.page).toBe(1)
			expect(result.meta.limit).toBe(20)
			expect(result.meta.totalPages).toBe(1)
		})
	})

	describe('getAccountById', () => {
		it('should return account when found', async () => {
			repositoryMock.findAccountById.mockResolvedValueOnce({ id: 'acc-1' } as any)

			const result = await service.getAccountById('acc-1')

			expect(result).toEqual({ id: 'acc-1' })
		})

		it('should throw NotFoundException when account not found', async () => {
			repositoryMock.findAccountById.mockResolvedValueOnce(null)

			await expect(service.getAccountById('unknown')).rejects.toThrow(NotFoundException)
		})
	})

	describe('updateAccountPlan', () => {
		it('should update plan and create audit log', async () => {
			repositoryMock.findAccountBasicInfo.mockResolvedValueOnce({
				id: 'acc-1',
				plan_type: 'free',
				role: 'seller',
			})
			repositoryMock.updateAccountPlan.mockResolvedValueOnce({ id: 'acc-1' } as any)
			repositoryMock.createAuditLog.mockResolvedValueOnce(undefined)

			await service.updateAccountPlan('acc-1', 'pro', 'admin-id')

			expect(repositoryMock.updateAccountPlan).toHaveBeenCalledWith('acc-1', 'pro')
			expect(repositoryMock.createAuditLog).toHaveBeenCalledWith(
				expect.objectContaining({ action: 'UPDATE_PLAN', entity: 'Account' }),
			)
		})

		it('should throw NotFoundException when account not found', async () => {
			repositoryMock.findAccountBasicInfo.mockResolvedValueOnce(null)

			await expect(service.updateAccountPlan('unknown', 'pro', 'admin-id')).rejects.toThrow(
				NotFoundException,
			)
		})

		it('should throw BadRequestException when target account is an admin', async () => {
			repositoryMock.findAccountBasicInfo.mockResolvedValueOnce({
				id: 'admin-acc',
				plan_type: 'free',
				role: 'admin',
			})

			await expect(service.updateAccountPlan('admin-acc', 'pro', 'another-admin')).rejects.toThrow(
				BadRequestException,
			)
		})
	})

	describe('suspendAccount', () => {
		it('should cancel subscriptions, downgrade to free, deactivate, and create audit log', async () => {
			repositoryMock.findAccountBasicInfo.mockResolvedValueOnce({
				id: 'acc-1',
				role: 'seller',
				plan_type: 'pro',
			})
			repositoryMock.cancelActiveSubscriptions.mockResolvedValueOnce(undefined)
			repositoryMock.updateAccount.mockResolvedValueOnce({
				id: 'acc-1',
				plan_type: 'free',
				is_active: false,
			})
			repositoryMock.createAuditLog.mockResolvedValueOnce(undefined)

			const result = await service.suspendAccount('acc-1', 'Violação de TOS', 'admin-id')

			expect(repositoryMock.cancelActiveSubscriptions).toHaveBeenCalledWith('acc-1')
			// is_active=false blocks future logins — suspension must revoke access,
			// not just downgrade the plan.
			expect(repositoryMock.updateAccount).toHaveBeenCalledWith(
				'acc-1',
				{ plan_type: 'free', is_active: false },
				expect.any(Object),
			)
			expect(repositoryMock.createAuditLog).toHaveBeenCalled()
			expect(result.suspended).toBe(true)
		})

		it('should throw BadRequestException when suspending an admin account', async () => {
			repositoryMock.findAccountBasicInfo.mockResolvedValueOnce({
				id: 'admin-acc',
				role: 'admin',
				plan_type: 'enterprise',
			})

			await expect(service.suspendAccount('admin-acc', 'reason', 'other-admin')).rejects.toThrow(
				BadRequestException,
			)
		})

		it('should throw NotFoundException when account not found', async () => {
			repositoryMock.findAccountBasicInfo.mockResolvedValueOnce(null)

			await expect(service.suspendAccount('unknown', 'reason', 'admin-id')).rejects.toThrow(
				NotFoundException,
			)
		})
	})

	describe('resetUserPassword', () => {
		it('should create a password reset token and audit log', async () => {
			repositoryMock.findAccountBasicInfo.mockResolvedValueOnce({
				id: 'acc-1',
				email: 'user@test.com',
				name: 'Alice',
			})
			repositoryMock.createPasswordResetToken.mockResolvedValueOnce(undefined)
			repositoryMock.createAuditLog.mockResolvedValueOnce(undefined)

			const result = await service.resetUserPassword('acc-1', 'admin-id')

			expect(repositoryMock.createPasswordResetToken).toHaveBeenCalled()
			expect(repositoryMock.createAuditLog).toHaveBeenCalledWith(
				expect.objectContaining({ action: 'ADMIN_PASSWORD_RESET' }),
			)
			expect(result.email).toBe('user@test.com')
			expect(result.token).toBeTruthy()
		})

		it('should throw NotFoundException when account not found', async () => {
			repositoryMock.findAccountBasicInfo.mockResolvedValueOnce(null)

			await expect(service.resetUserPassword('unknown', 'admin-id')).rejects.toThrow(
				NotFoundException,
			)
		})
	})

	describe('disable2FA', () => {
		it('should disable 2FA and create audit log', async () => {
			repositoryMock.findAccountBasicInfo.mockResolvedValueOnce({
				id: 'acc-1',
				two_factor_enabled: true,
			})
			repositoryMock.updateAccount.mockResolvedValueOnce({ id: 'acc-1', two_factor_enabled: false })
			repositoryMock.createAuditLog.mockResolvedValueOnce(undefined)

			await service.disable2FA('acc-1', 'admin-id')

			expect(repositoryMock.updateAccount).toHaveBeenCalledWith(
				'acc-1',
				{ two_factor_enabled: false, two_factor_secret: null },
				expect.any(Object),
			)
			expect(repositoryMock.createAuditLog).toHaveBeenCalled()
		})

		it('should throw BadRequestException when 2FA already disabled', async () => {
			repositoryMock.findAccountBasicInfo.mockResolvedValueOnce({
				id: 'acc-1',
				two_factor_enabled: false,
			})

			await expect(service.disable2FA('acc-1', 'admin-id')).rejects.toThrow(BadRequestException)
		})

		it('should throw NotFoundException when account not found', async () => {
			repositoryMock.findAccountBasicInfo.mockResolvedValueOnce(null)

			await expect(service.disable2FA('unknown', 'admin-id')).rejects.toThrow(NotFoundException)
		})
	})

	describe('getAccountUsage', () => {
		it('should return usage with limits for the account plan', async () => {
			repositoryMock.findAccountBasicInfo.mockResolvedValueOnce({ id: 'acc-1', plan_type: 'free' })
			repositoryMock.getAccountUsageCounts.mockResolvedValueOnce({
				products: 10,
				orders: 15,
				customers: 20,
			})

			const result = await service.getAccountUsage('acc-1')

			expect(result.plan).toBe('free')
			expect(result.usage.products.current).toBe(10)
			expect(result.usage.products.limit).toBe(50) // free plan limit
		})

		it('should throw NotFoundException when account not found', async () => {
			repositoryMock.findAccountBasicInfo.mockResolvedValueOnce(null)

			await expect(service.getAccountUsage('unknown')).rejects.toThrow(NotFoundException)
		})
	})

	describe('getActiveUsers', () => {
		it('should return users active in the last 30 minutes', async () => {
			repositoryMock.findActiveUsers.mockResolvedValueOnce([{ id: 'u1' }] as any)

			const result = await service.getActiveUsers()

			expect(repositoryMock.findActiveUsers).toHaveBeenCalledWith(expect.any(Date))
			expect(result).toHaveLength(1)
		})
	})

	describe('getSubscriptionStats', () => {
		it('should return formatted subscription statistics', async () => {
			repositoryMock.getSubscriptionStats.mockResolvedValueOnce({
				byPlan: [{ plan_type: 'free', _count: { id: 50 } }] as any,
				recentSubscriptions: [],
				expiringSubscriptions: [],
			})

			const result = await service.getSubscriptionStats()

			expect(result.byPlan[0].plan).toBe('free')
			expect(result.byPlan[0].count).toBe(50)
		})
	})

	describe('getAuditLogs', () => {
		it('should return paginated audit logs', async () => {
			repositoryMock.findAuditLogs.mockResolvedValueOnce({
				data: [{ id: 1 }] as any,
				total: 1,
			})

			const result = await service.getAuditLogs(1, 50)

			expect(result.data).toHaveLength(1)
			expect(result.meta.totalPages).toBe(1)
		})
	})

	describe('getSystemHealth', () => {
		it('should return healthy status when DB is connected', async () => {
			repositoryMock.checkDatabaseHealth.mockResolvedValueOnce(true)

			const result = await service.getSystemHealth()

			expect(result.status).toBe('healthy')
			expect(result.database).toBe('connected')
			expect(typeof result.environment).toBe('string')
			expect(result.environment.length).toBeGreaterThan(0)
		})

		it('should return disconnected when DB health check fails', async () => {
			repositoryMock.checkDatabaseHealth.mockResolvedValueOnce(false)

			const result = await service.getSystemHealth()

			expect(result.database).toBe('disconnected')
			expect(typeof result.environment).toBe('string')
			expect(result.environment.length).toBeGreaterThan(0)
		})
	})

	describe('updateAccount', () => {
		it('should update account fields and create audit log', async () => {
			repositoryMock.findAccountBasicInfo.mockResolvedValueOnce({
				id: 'acc-1',
				name: 'Old Name',
				email: 'old@ex.com',
				role: 'seller',
				plan_type: 'free',
			})
			repositoryMock.updateAccount.mockResolvedValueOnce({
				id: 'acc-1',
				name: 'New Name',
				email: 'new@ex.com',
				role: 'seller',
				plan_type: 'pro',
			})
			repositoryMock.createAuditLog.mockResolvedValueOnce(undefined)

			const result = await service.updateAccount(
				'acc-1',
				{ name: 'New Name', email: 'new@ex.com', role: 'seller', plan_type: 'pro' },
				'admin-id',
			)

			expect(repositoryMock.updateAccount).toHaveBeenCalledWith(
				'acc-1',
				{ name: 'New Name', email: 'new@ex.com', role: 'seller', plan_type: 'pro' },
				expect.any(Object),
			)
			expect(repositoryMock.createAuditLog).toHaveBeenCalledWith(
				expect.objectContaining({ action: 'ADMIN_UPDATE_ACCOUNT', entity: 'Account' }),
			)
			expect(result).toMatchObject({ id: 'acc-1', name: 'New Name' })
		})

		it('should throw NotFoundException when account not found', async () => {
			repositoryMock.findAccountBasicInfo.mockResolvedValueOnce(null)

			await expect(service.updateAccount('unknown', { name: 'X' }, 'admin-id')).rejects.toThrow(
				NotFoundException,
			)

			expect(repositoryMock.updateAccount).not.toHaveBeenCalled()
		})
	})

	describe('createAccount', () => {
		it('should hash password and create account with audit log', async () => {
			repositoryMock.createAccount.mockResolvedValueOnce({
				id: 'new-acc',
				name: 'Loja Nova',
				email: 'loja@ex.com',
				plan_type: 'free',
			})
			repositoryMock.createAuditLog.mockResolvedValueOnce(undefined)

			const result = await service.createAccount({
				name: 'Loja Nova',
				email: 'loja@ex.com',
				password: 'S3cret!',
				adminId: 'admin-id',
			})

			expect(passwordHasherMock.hash).toHaveBeenCalledWith('S3cret!')
			expect(repositoryMock.createAccount).toHaveBeenCalledWith(
				expect.objectContaining({ email: 'loja@ex.com', password: 'hashed', salt: 'salt' }),
			)
			expect(repositoryMock.createAuditLog).toHaveBeenCalledWith(
				expect.objectContaining({ action: 'ADMIN_CREATE_ACCOUNT' }),
			)
			expect(result.id).toBe('new-acc')
		})

		it('should throw ConflictException on duplicate email', async () => {
			const p2002 = new Error('Unique constraint') as any
			p2002.code = 'P2002'
			Object.setPrototypeOf(p2002, Prisma.PrismaClientKnownRequestError.prototype)
			repositoryMock.createAccount.mockRejectedValueOnce(p2002)

			await expect(
				service.createAccount({ name: 'X', email: 'dup@ex.com', password: 'pw', adminId: 'admin' }),
			).rejects.toThrow(ConflictException)
		})
	})

	describe('deleteAccount', () => {
		it('should delete account and create audit log', async () => {
			repositoryMock.findAccountBasicInfo.mockResolvedValueOnce({
				id: 'acc-1',
				name: 'Loja',
				email: 'loja@ex.com',
				role: 'seller',
			})
			repositoryMock.deleteAccount.mockResolvedValueOnce(undefined)
			repositoryMock.createAuditLog.mockResolvedValueOnce(undefined)

			await service.deleteAccount('acc-1', 'admin-id')

			expect(repositoryMock.deleteAccount).toHaveBeenCalledWith('acc-1')
			expect(repositoryMock.createAuditLog).toHaveBeenCalledWith(
				expect.objectContaining({ action: 'ADMIN_DELETE_ACCOUNT' }),
			)
		})

		it('should throw NotFoundException when account not found', async () => {
			repositoryMock.findAccountBasicInfo.mockResolvedValueOnce(null)

			await expect(service.deleteAccount('unknown', 'admin-id')).rejects.toThrow(NotFoundException)
		})

		it('should throw BadRequestException when deleting an admin account', async () => {
			repositoryMock.findAccountBasicInfo.mockResolvedValueOnce({
				id: 'admin-acc',
				name: 'Admin',
				email: 'admin@ex.com',
				role: 'admin',
			})

			await expect(service.deleteAccount('admin-acc', 'other-admin')).rejects.toThrow(
				BadRequestException,
			)
		})
	})
})
