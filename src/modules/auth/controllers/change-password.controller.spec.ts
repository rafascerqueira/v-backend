/**
 * ChangePasswordController unit tests
 * Covers: POST /auth/change-password — change authenticated user's password
 * Guards mocked: JwtAuthGuard
 */

import { NotFoundException, UnauthorizedException } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard'
import { AccountService } from '@/modules/users/services/account.service'
import { ChangePasswordController } from './change-password.controller'

const accountServiceMock = {
	changePassword: jest.fn(),
}

const mockUser = {
	sub: 'user-uuid-1',
	email: 'test@example.com',
	role: 'seller' as const,
	plan_type: 'free' as const,
}

describe('ChangePasswordController', () => {
	let controller: ChangePasswordController

	beforeEach(async () => {
		const module = await Test.createTestingModule({
			controllers: [ChangePasswordController],
			providers: [{ provide: AccountService, useValue: accountServiceMock }],
		})
			.overrideGuard(JwtAuthGuard)
			.useValue({ canActivate: () => true })
			.compile()

		controller = module.get(ChangePasswordController)
		jest.clearAllMocks()
	})

	describe('changePassword', () => {
		it('should return success message when accountService.changePassword resolves', async () => {
			accountServiceMock.changePassword.mockResolvedValueOnce(undefined)

			const result = await controller.changePassword(mockUser as any, {
				currentPassword: 'old',
				newPassword: 'newPass123',
			})

			expect(accountServiceMock.changePassword).toHaveBeenCalledWith(
				'user-uuid-1',
				'old',
				'newPass123',
			)
			expect(result).toEqual({ message: 'Senha alterada com sucesso' })
		})

		it('should propagate UnauthorizedException when current password is wrong', async () => {
			accountServiceMock.changePassword.mockRejectedValueOnce(
				new UnauthorizedException('Senha atual incorreta'),
			)

			await expect(
				controller.changePassword(mockUser as any, {
					currentPassword: 'wrong',
					newPassword: 'newPass123',
				}),
			).rejects.toThrow(UnauthorizedException)
		})

		it('should propagate NotFoundException when user is not found', async () => {
			accountServiceMock.changePassword.mockRejectedValueOnce(
				new NotFoundException('User not found'),
			)

			await expect(
				controller.changePassword(mockUser as any, {
					currentPassword: 'old',
					newPassword: 'newPass123',
				}),
			).rejects.toThrow(NotFoundException)
		})
	})
})
