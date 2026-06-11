/**
 * ForgotPasswordController unit tests
 * Covers: POST /auth/forgot-password — @Public, always returns generic success message
 * Guards mocked: JwtAuthGuard
 */

import { Test } from '@nestjs/testing'
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard'
import { PasswordResetService } from '../services/password-reset.service'
import { ForgotPasswordController } from './forgot-password.controller'

const passwordResetServiceMock = {
	createResetToken: jest.fn(),
}

describe('ForgotPasswordController', () => {
	let controller: ForgotPasswordController

	beforeEach(async () => {
		const module = await Test.createTestingModule({
			controllers: [ForgotPasswordController],
			providers: [{ provide: PasswordResetService, useValue: passwordResetServiceMock }],
		})
			.overrideGuard(JwtAuthGuard)
			.useValue({ canActivate: () => true })
			.compile()

		controller = module.get(ForgotPasswordController)
		jest.clearAllMocks()
	})

	describe('forgotPassword', () => {
		it('should call service and return generic success message', async () => {
			passwordResetServiceMock.createResetToken.mockResolvedValueOnce(undefined)

			const result = await controller.forgotPassword({ email: 'user@example.com' })

			expect(passwordResetServiceMock.createResetToken).toHaveBeenCalledWith('user@example.com')
			expect(result).toMatchObject({ message: expect.any(String) })
		})

		it('should return the same message even if email does not exist (security: no enumeration)', async () => {
			passwordResetServiceMock.createResetToken.mockResolvedValueOnce(undefined)

			const result1 = await controller.forgotPassword({ email: 'exists@example.com' })

			passwordResetServiceMock.createResetToken.mockResolvedValueOnce(undefined)

			const result2 = await controller.forgotPassword({ email: 'notfound@example.com' })

			expect(result1.message).toBe(result2.message)
		})

		it('should propagate unexpected service errors', async () => {
			passwordResetServiceMock.createResetToken.mockRejectedValueOnce(
				new Error('Queue unavailable'),
			)

			await expect(controller.forgotPassword({ email: 'user@example.com' })).rejects.toThrow(
				'Queue unavailable',
			)
		})
	})
})
