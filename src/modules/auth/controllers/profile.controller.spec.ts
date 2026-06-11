/**
 * ProfileController unit tests
 * Covers: PATCH /auth/profile — update name on authenticated user
 * Guards mocked: JwtAuthGuard (global default)
 */

import { Test } from '@nestjs/testing'
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard'
import { AccountService } from '@/modules/users/services/account.service'
import { ProfileController } from './profile.controller'

const accountServiceMock = {
	updateProfile: jest.fn(),
}

const mockUser = {
	sub: 'user-uuid-1',
	email: 'test@example.com',
	role: 'seller' as const,
	plan_type: 'free' as const,
}

describe('ProfileController', () => {
	let controller: ProfileController

	beforeEach(async () => {
		const module = await Test.createTestingModule({
			controllers: [ProfileController],
			providers: [{ provide: AccountService, useValue: accountServiceMock }],
		})
			.overrideGuard(JwtAuthGuard)
			.useValue({ canActivate: () => true })
			.compile()

		controller = module.get(ProfileController)
		jest.clearAllMocks()
	})

	describe('updateProfile', () => {
		it('should call accountService.updateProfile and return the result', async () => {
			const updatedAccount = { id: 'user-uuid-1', name: 'New Name' }
			accountServiceMock.updateProfile.mockResolvedValueOnce(updatedAccount)

			const result = await controller.updateProfile(mockUser as any, { name: 'New Name' })

			expect(accountServiceMock.updateProfile).toHaveBeenCalledWith('user-uuid-1', {
				name: 'New Name',
			})
			expect(result).toEqual(updatedAccount)
		})

		it('should call accountService with empty body when no fields provided', async () => {
			accountServiceMock.updateProfile.mockResolvedValueOnce({ id: 'user-uuid-1' })

			const result = await controller.updateProfile(mockUser as any, {})

			expect(accountServiceMock.updateProfile).toHaveBeenCalledWith('user-uuid-1', {})
			expect(result).toBeDefined()
		})

		it('should propagate errors from service', async () => {
			accountServiceMock.updateProfile.mockRejectedValueOnce(new Error('Update failed'))

			await expect(controller.updateProfile(mockUser as any, { name: 'X' })).rejects.toThrow(
				'Update failed',
			)
		})
	})
})
