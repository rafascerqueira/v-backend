/**
 * EmailVerificationController unit tests
 * Covers: POST /auth/verify-email, POST /auth/resend-verification
 * Both routes are @Public — no auth guard required
 */

import { BadRequestException } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard'
import { EmailVerificationService } from '../services/email-verification.service'
import { EmailVerificationController } from './email-verification.controller'

const emailVerificationServiceMock = {
	verifyEmail: jest.fn(),
	resendVerification: jest.fn(),
}

describe('EmailVerificationController', () => {
	let controller: EmailVerificationController

	beforeEach(async () => {
		const module = await Test.createTestingModule({
			controllers: [EmailVerificationController],
			providers: [{ provide: EmailVerificationService, useValue: emailVerificationServiceMock }],
		})
			.overrideGuard(JwtAuthGuard)
			.useValue({ canActivate: () => true })
			.compile()

		controller = module.get(EmailVerificationController)
		jest.clearAllMocks()
	})

	describe('verifyEmail', () => {
		it('should return success message when token is valid', async () => {
			emailVerificationServiceMock.verifyEmail.mockResolvedValueOnce({
				success: true,
				message: 'Email verified successfully',
			})

			const result = await controller.verifyEmail({ token: 'valid-token-123' })

			expect(emailVerificationServiceMock.verifyEmail).toHaveBeenCalledWith('valid-token-123')
			expect(result).toEqual({ message: 'Email verified successfully' })
		})

		it('should throw BadRequestException when service returns failure', async () => {
			emailVerificationServiceMock.verifyEmail.mockResolvedValueOnce({
				success: false,
				message: 'Token inválido ou expirado',
			})

			await expect(controller.verifyEmail({ token: 'bad-token' })).rejects.toThrow(
				BadRequestException,
			)
		})
	})

	describe('resendVerification', () => {
		it('should return success message when email is valid', async () => {
			emailVerificationServiceMock.resendVerification.mockResolvedValueOnce({
				success: true,
				message: 'Verification email sent',
			})

			const result = await controller.resendVerification({ email: 'user@example.com' })

			expect(emailVerificationServiceMock.resendVerification).toHaveBeenCalledWith(
				'user@example.com',
			)
			expect(result).toEqual({ message: 'Verification email sent' })
		})

		it('should throw BadRequestException when service returns failure', async () => {
			emailVerificationServiceMock.resendVerification.mockResolvedValueOnce({
				success: false,
				message: 'Too many requests',
			})

			await expect(controller.resendVerification({ email: 'user@example.com' })).rejects.toThrow(
				BadRequestException,
			)
		})
	})
})
