/**
 * AccountExceptionService unit tests
 * Covers: create, revoke, list, listByAccount, resolveActiveExceptions
 */
import { NotFoundException } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { SettingsService } from '@/modules/admin/services/settings.service'
import {
	ACCOUNT_EXCEPTION_REPOSITORY,
	type AccountExceptionRecord,
	type AccountExceptionRepository,
} from '@/shared/repositories/account-exception.repository'
import { AccountExceptionService } from './account-exception.service'

const repositoryMock: jest.Mocked<AccountExceptionRepository> = {
	create: jest.fn(),
	findById: jest.fn(),
	findActiveByAccountId: jest.fn(),
	findByAccountId: jest.fn(),
	findMany: jest.fn(),
	revoke: jest.fn(),
	countActivePlanGrants: jest.fn(),
}

const settingsServiceMock = {
	getPlanGrantQuotas: jest.fn().mockResolvedValue({ pro: 0, enterprise: 0 }),
}

function record(partial: Partial<AccountExceptionRecord>): AccountExceptionRecord {
	return {
		id: 'ex-1',
		account_id: 'acc-1',
		type: 'unlimited_window',
		status: 'active',
		effective_from: new Date('2026-01-01'),
		effective_until: null,
		metadata: {},
		reason: 'reason',
		created_by: 'admin-1',
		revoked_by: null,
		revoked_at: null,
		revoke_reason: null,
		createdAt: new Date(),
		updatedAt: new Date(),
		...partial,
	}
}

describe('AccountExceptionService', () => {
	let service: AccountExceptionService

	beforeEach(async () => {
		const module = await Test.createTestingModule({
			providers: [
				AccountExceptionService,
				{ provide: ACCOUNT_EXCEPTION_REPOSITORY, useValue: repositoryMock },
				{ provide: SettingsService, useValue: settingsServiceMock },
			],
		}).compile()

		service = module.get(AccountExceptionService)
		jest.clearAllMocks()
		settingsServiceMock.getPlanGrantQuotas.mockResolvedValue({
			pro: 0,
			enterprise: 0,
		})
	})

	describe('create', () => {
		it('should create with actor and effective dates', async () => {
			repositoryMock.create.mockResolvedValueOnce(record({}))

			await service.create('acc-1', 'admin-1', {
				type: 'unlimited_window',
				effectiveFrom: '2026-06-01T00:00:00Z',
				effectiveUntil: '2026-12-31T00:00:00Z',
				reason: 'gift',
				metadata: {},
			})

			expect(repositoryMock.create).toHaveBeenCalledWith(
				expect.objectContaining({
					account_id: 'acc-1',
					type: 'unlimited_window',
					created_by: 'admin-1',
				}),
			)
		})
	})

	describe('revoke', () => {
		it('should throw when not found', async () => {
			repositoryMock.findById.mockResolvedValueOnce(null)

			await expect(service.revoke('ex-x', 'admin-1', { reason: 'mistake' })).rejects.toBeInstanceOf(
				NotFoundException,
			)
		})

		it('should throw when already revoked', async () => {
			repositoryMock.findById.mockResolvedValueOnce(record({ status: 'revoked' }))

			await expect(service.revoke('ex-1', 'admin-1', { reason: 'mistake' })).rejects.toBeInstanceOf(
				NotFoundException,
			)
		})

		it('should revoke an active exception', async () => {
			repositoryMock.findById.mockResolvedValueOnce(record({}))
			repositoryMock.revoke.mockResolvedValueOnce(record({ status: 'revoked' }))

			const result = await service.revoke('ex-1', 'admin-1', { reason: 'mistake' })

			expect(repositoryMock.revoke).toHaveBeenCalledWith('ex-1', {
				revoked_by: 'admin-1',
				revoke_reason: 'mistake',
			})
			expect(result.status).toBe('revoked')
		})
	})

	describe('resolveActiveExceptions', () => {
		it('should pick unlimited_window when present', async () => {
			repositoryMock.findActiveByAccountId.mockResolvedValueOnce([
				record({ type: 'unlimited_window' }),
			])

			const result = await service.resolveActiveExceptions('acc-1')

			expect(result.unlimitedWindow).not.toBeNull()
			expect(result.planGrant).toBeNull()
		})

		it('should resolve plan_grant', async () => {
			repositoryMock.findActiveByAccountId.mockResolvedValueOnce([
				record({
					type: 'plan_grant',
					metadata: { grantedPlan: 'pro', previousPlan: 'free' },
				}),
			])

			const result = await service.resolveActiveExceptions('acc-1')

			expect(result.planGrant?.grantedPlan).toBe('pro')
		})

		it('should resolve custom_limits with overrides', async () => {
			repositoryMock.findActiveByAccountId.mockResolvedValueOnce([
				record({
					type: 'custom_limits',
					metadata: { maxProducts: 75, maxCustomers: 200 },
				}),
			])

			const result = await service.resolveActiveExceptions('acc-1')

			expect(result.customLimits?.maxProducts).toBe(75)
			expect(result.customLimits?.maxCustomers).toBe(200)
			expect(result.customLimits?.maxOrdersPerMonth).toBeUndefined()
		})

		it('should resolve billing_adjustment', async () => {
			repositoryMock.findActiveByAccountId.mockResolvedValueOnce([
				record({
					type: 'billing_adjustment',
					metadata: {
						nextBillingDate: '2026-08-01T00:00:00Z',
						previousNextBillingDate: '2026-07-01T00:00:00Z',
					},
				}),
			])

			const result = await service.resolveActiveExceptions('acc-1')

			expect(result.billingAdjustment?.nextBillingDate).toBeInstanceOf(Date)
		})

		it('should return all-null when no records', async () => {
			repositoryMock.findActiveByAccountId.mockResolvedValueOnce([])

			const result = await service.resolveActiveExceptions('acc-1')

			expect(result).toEqual({
				unlimitedWindow: null,
				planGrant: null,
				customLimits: null,
				billingAdjustment: null,
			})
		})
	})

	describe('getPlanGrantStats', () => {
		it('should return active counts vs quotas with non-exceeded flag', async () => {
			repositoryMock.countActivePlanGrants.mockResolvedValueOnce(3)
			repositoryMock.countActivePlanGrants.mockResolvedValueOnce(1)
			settingsServiceMock.getPlanGrantQuotas.mockResolvedValueOnce({
				pro: 10,
				enterprise: 5,
			})

			const stats = await service.getPlanGrantStats()

			expect(stats.pro).toEqual({ active: 3, quota: 10, exceeded: false })
			expect(stats.enterprise).toEqual({
				active: 1,
				quota: 5,
				exceeded: false,
			})
		})

		it('should mark exceeded when active count >= quota', async () => {
			repositoryMock.countActivePlanGrants.mockResolvedValueOnce(10)
			repositoryMock.countActivePlanGrants.mockResolvedValueOnce(0)
			settingsServiceMock.getPlanGrantQuotas.mockResolvedValueOnce({
				pro: 10,
				enterprise: 0,
			})

			const stats = await service.getPlanGrantStats()

			expect(stats.pro.exceeded).toBe(true)
			expect(stats.enterprise.exceeded).toBe(false)
		})

		it('should treat quota=0 as unlimited (never exceeded)', async () => {
			repositoryMock.countActivePlanGrants.mockResolvedValueOnce(999)
			repositoryMock.countActivePlanGrants.mockResolvedValueOnce(999)
			settingsServiceMock.getPlanGrantQuotas.mockResolvedValueOnce({
				pro: 0,
				enterprise: 0,
			})

			const stats = await service.getPlanGrantStats()

			expect(stats.pro.exceeded).toBe(false)
			expect(stats.enterprise.exceeded).toBe(false)
		})
	})

	describe('list', () => {
		it('should pass pagination through to repository', async () => {
			repositoryMock.findMany.mockResolvedValueOnce({ data: [], total: 0 })

			const result = await service.list({ status: 'active' }, 2, 10)

			expect(repositoryMock.findMany).toHaveBeenCalledWith({ status: 'active' }, 10, 10)
			expect(result).toEqual({ data: [], total: 0, page: 2, limit: 10 })
		})
	})
})
