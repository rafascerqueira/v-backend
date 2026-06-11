/**
 * ResetPasswordController unit tests
 * Covers: POST /auth/reset-password — @Public, validates token and resets password
 * Guards mocked: JwtAuthGuard
 */

import { BadRequestException } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard'
import { PasswordResetService } from '../services/password-reset.service'
import { ResetPasswordController } from './reset-password.controller'

const passwordResetServiceMock = {
	resetPassword: jest.fn(),
}

describe('ResetPasswordController', () => {
	let controller: ResetPasswordController

	beforeEach(async () => {
		const module = await Test.createTestingModule({
			controllers: [ResetPasswordController],
			providers: [{ provide: PasswordResetService, useValue: passwordResetServiceMock }],
		})
			.overrideGuard(JwtAuthGuard)
			.useValue({ canActivate: () => true })
			.compile()

		controller = module.get(ResetPasswordController)
		jest.clearAllMocks()
	})

	describe('resetPassword', () => {
		const validBody = { token: 'valid-reset-token', password: 'NewPassword123!' }

		it('should return success message when token is valid', async () => {
			passwordResetServiceMock.resetPassword.mockResolvedValueOnce(true)

			const result = await controller.resetPassword(validBody)

			expect(passwordResetServiceMock.resetPassword).toHaveBeenCalledWith(
				'valid-reset-token',
				'NewPassword123!',
			)
			expect(result).toMatchObject({ message: expect.any(String) })
		})

		it('should throw BadRequestException when token is invalid or expired', async () => {
			passwordResetServiceMock.resetPassword.mockResolvedValueOnce(false)

			await expect(controller.resetPassword(validBody)).rejects.toThrow(BadRequestException)
		})

		it('should propagate unexpected errors from service', async () => {
			passwordResetServiceMock.resetPassword.mockRejectedValueOnce(new Error('DB error'))

			await expect(controller.resetPassword(validBody)).rejects.toThrow('DB error')
		})
	})
})
