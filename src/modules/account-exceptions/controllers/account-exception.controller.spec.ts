/**
 * AccountExceptionController unit tests
 * Covers: list, listForAccount, create, revoke
 * Guards mocked: JwtAuthGuard, RolesGuard
 */
import { BadRequestException } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard'
import { RolesGuard } from '@/modules/auth/guards/roles.guard'
import { AccountExceptionService } from '../services/account-exception.service'
import { AccountExceptionController } from './account-exception.controller'

const serviceMock = {
	create: jest.fn(),
	revoke: jest.fn(),
	listByAccount: jest.fn(),
	list: jest.fn(),
	getPlanGrantStats: jest.fn(),
}

describe('AccountExceptionController', () => {
	let controller: AccountExceptionController

	beforeEach(async () => {
		const module = await Test.createTestingModule({
			controllers: [AccountExceptionController],
			providers: [{ provide: AccountExceptionService, useValue: serviceMock }],
		})
			.overrideGuard(JwtAuthGuard)
			.useValue({ canActivate: () => true })
			.overrideGuard(RolesGuard)
			.useValue({ canActivate: () => true })
			.compile()

		controller = module.get(AccountExceptionController)
		jest.clearAllMocks()
	})

	describe('list', () => {
		it('should default page/limit and pass filter to service', async () => {
			serviceMock.list.mockResolvedValueOnce({ data: [], total: 0, page: 1, limit: 20 })

			await controller.list({ status: 'active' })

			expect(serviceMock.list).toHaveBeenCalledWith({ status: 'active' }, 1, 20)
		})

		it('should reject invalid type', async () => {
			await expect(controller.list({ type: 'bogus' })).rejects.toBeInstanceOf(BadRequestException)
		})
	})

	describe('getStats', () => {
		it('should delegate to service', async () => {
			serviceMock.getPlanGrantStats.mockResolvedValueOnce({
				pro: { active: 2, quota: 10, exceeded: false },
				enterprise: { active: 0, quota: 0, exceeded: false },
			})

			const result = await controller.getStats()

			expect(result.pro.active).toBe(2)
			expect(serviceMock.getPlanGrantStats).toHaveBeenCalled()
		})
	})

	describe('listForAccount', () => {
		it('should delegate to service', async () => {
			serviceMock.listByAccount.mockResolvedValueOnce([])
			await controller.listForAccount('acc-1')
			expect(serviceMock.listByAccount).toHaveBeenCalledWith('acc-1')
		})
	})

	describe('create', () => {
		const req = { user: { sub: 'admin-1' } } as any

		it('should reject when payload invalid (unknown type)', async () => {
			await expect(controller.create('acc-1', { type: 'foo' }, req)).rejects.toBeInstanceOf(
				BadRequestException,
			)
		})

		it('should accept unlimited_window payload', async () => {
			serviceMock.create.mockResolvedValueOnce({ id: 'ex-1' })

			await controller.create(
				'acc-1',
				{
					type: 'unlimited_window',
					effectiveFrom: '2026-06-01T00:00:00Z',
					effectiveUntil: '2026-12-31T00:00:00Z',
					reason: 'gift',
				},
				req,
			)

			expect(serviceMock.create).toHaveBeenCalledWith(
				'acc-1',
				'admin-1',
				expect.objectContaining({ type: 'unlimited_window' }),
			)
		})

		it('should accept plan_grant payload', async () => {
			serviceMock.create.mockResolvedValueOnce({ id: 'ex-1' })

			await controller.create(
				'acc-1',
				{
					type: 'plan_grant',
					effectiveFrom: '2026-06-01T00:00:00Z',
					effectiveUntil: null,
					reason: 'comp',
					metadata: { grantedPlan: 'pro', previousPlan: 'free' },
				},
				req,
			)

			expect(serviceMock.create).toHaveBeenCalled()
		})

		it('should reject custom_limits with no overrides', async () => {
			await expect(
				controller.create(
					'acc-1',
					{
						type: 'custom_limits',
						effectiveFrom: '2026-06-01T00:00:00Z',
						effectiveUntil: null,
						reason: 'tweak',
						metadata: {},
					},
					req,
				),
			).rejects.toBeInstanceOf(BadRequestException)
		})
	})

	describe('revoke', () => {
		const req = { user: { sub: 'admin-1' } } as any

		it('should reject empty reason', async () => {
			await expect(controller.revoke('ex-1', { reason: '' }, req)).rejects.toBeInstanceOf(
				BadRequestException,
			)
		})

		it('should pass actor and reason', async () => {
			serviceMock.revoke.mockResolvedValueOnce({ id: 'ex-1', status: 'revoked' })

			await controller.revoke('ex-1', { reason: 'mistake' }, req)

			expect(serviceMock.revoke).toHaveBeenCalledWith('ex-1', 'admin-1', {
				reason: 'mistake',
			})
		})
	})
})
