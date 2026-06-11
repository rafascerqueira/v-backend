/**
 * MeController unit tests
 * Covers: GET /auth/me — returns current user data or 404 if not found
 * Guards mocked: JwtAuthGuard (global default)
 */

import { NotFoundException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Test } from '@nestjs/testing'
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard'
import { AccountService } from '@/modules/users/services/account.service'
import { MeController } from './me.controller'

const accountServiceMock = {
	findById: jest.fn(),
}

const configServiceMock = {
	get: jest.fn((_key: string, fallback?: unknown) => fallback ?? 'http://localhost:3001'),
}

const mockUser = {
	sub: 'user-uuid-1',
	email: 'test@example.com',
	role: 'seller' as const,
	plan_type: 'free' as const,
}

const makeReply = () => ({ setCookie: jest.fn() }) as any
const makeRequest = (cookies: Record<string, string> = {}) => ({ cookies }) as any

describe('MeController', () => {
	let controller: MeController

	beforeEach(async () => {
		const module = await Test.createTestingModule({
			controllers: [MeController],
			providers: [
				{ provide: AccountService, useValue: accountServiceMock },
				{ provide: ConfigService, useValue: configServiceMock },
			],
		})
			.overrideGuard(JwtAuthGuard)
			.useValue({ canActivate: () => true })
			.compile()

		controller = module.get(MeController)
		jest.clearAllMocks()
	})

	describe('me', () => {
		it('should return the current user data', async () => {
			const account = {
				id: 'user-uuid-1',
				name: 'Test User',
				email: 'test@example.com',
				role: 'seller',
				plan_type: 'free',
				createdAt: new Date('2024-01-01'),
				updatedAt: new Date('2024-01-02'),
			}
			accountServiceMock.findById.mockResolvedValueOnce(account)

			const reply = makeReply()
			const result = await controller.me(mockUser as any, makeRequest() as any, reply as any)

			expect(accountServiceMock.findById).toHaveBeenCalledWith('user-uuid-1')
			// CSRF cookie is seeded when the request arrives without one.
			expect(reply.setCookie).toHaveBeenCalledWith(
				'csrf_token',
				expect.any(String),
				expect.objectContaining({ maxAge: 7 * 24 * 60 * 60 }),
			)
			expect(result).toMatchObject({
				id: account.id,
				name: account.name,
				email: account.email,
				role: account.role,
				planType: account.plan_type,
				avatar: null,
				createdAt: account.createdAt,
				updatedAt: account.updatedAt,
			})
		})

		it('resolves an uploaded avatar key to the authenticated proxy URL', async () => {
			accountServiceMock.findById.mockResolvedValueOnce({
				id: 'user-uuid-1',
				name: 'Test User',
				email: 'test@example.com',
				role: 'seller',
				plan_type: 'free',
				avatar: 'profiles/user-uuid-1-profile.webp',
				createdAt: new Date('2024-01-01'),
				updatedAt: new Date('2024-01-02'),
			})

			const result = (await controller.me(
				mockUser as any,
				makeRequest() as any,
				makeReply() as any,
			)) as { avatar: string }

			expect(result.avatar).toBe(
				`http://localhost:3001/auth/profile/avatar?v=${new Date('2024-01-02').getTime()}`,
			)
		})

		it('does NOT rotate the CSRF cookie when one is already present', async () => {
			// Rotating on this frequently-polled read caused a double-submit race
			// (header/cookie divergence → 403). Seed only when absent.
			accountServiceMock.findById.mockResolvedValueOnce({
				id: 'user-uuid-1',
				name: 'Test User',
				email: 'test@example.com',
				role: 'seller',
				plan_type: 'free',
				createdAt: new Date('2024-01-01'),
				updatedAt: new Date('2024-01-02'),
			})

			const reply = makeReply()
			await controller.me(
				mockUser as any,
				makeRequest({ csrf_token: 'existing-token' }) as any,
				reply as any,
			)

			expect(reply.setCookie).not.toHaveBeenCalled()
		})

		it('should throw NotFoundException when account does not exist', async () => {
			accountServiceMock.findById.mockResolvedValueOnce(null)

			await expect(
				controller.me(mockUser as any, makeRequest() as any, makeReply() as any),
			).rejects.toThrow(NotFoundException)
		})
	})
})
