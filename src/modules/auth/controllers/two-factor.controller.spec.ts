/**
 * TwoFactorController unit tests
 * Covers: POST /auth/2fa/generate, setup, enable, backup-codes (enrollment
 *         closed → 404), disable (requires code), verify, GET status,
 *         POST verify-backup
 * Guards mocked: JwtAuthGuard
 */

import { NotFoundException } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard'
import { TwoFactorService } from '../services/two-factor.service'
import { TwoFactorController } from './two-factor.controller'

const twoFactorServiceMock = {
	generateSecret: jest.fn(),
	enableTwoFactor: jest.fn(),
	disableTwoFactor: jest.fn(),
	verifyToken: jest.fn(),
	isTwoFactorEnabled: jest.fn(),
	getRemainingBackupCodesCount: jest.fn(),
	generateBackupCodes: jest.fn(),
	verifyBackupCode: jest.fn(),
}

function makeRequest(sub = 'user-uuid-1') {
	return { user: { sub } }
}

describe('TwoFactorController', () => {
	let controller: TwoFactorController

	beforeEach(async () => {
		const module = await Test.createTestingModule({
			controllers: [TwoFactorController],
			providers: [{ provide: TwoFactorService, useValue: twoFactorServiceMock }],
		})
			.overrideGuard(JwtAuthGuard)
			.useValue({ canActivate: () => true })
			.compile()

		controller = module.get(TwoFactorController)
		jest.clearAllMocks()
	})

	describe('enrollment (closed until the full 2FA flow ships)', () => {
		it.each([
			['generateSecret', () => controller.generateSecret(makeRequest())],
			['setup', () => controller.setup(makeRequest())],
			['enable', () => controller.enable(makeRequest(), '123456')],
			['generateBackupCodes', () => controller.generateBackupCodes(makeRequest())],
		])('%s responds 404 and never touches the service', async (_name, call) => {
			await expect(call()).rejects.toBeInstanceOf(NotFoundException)
			expect(twoFactorServiceMock.generateSecret).not.toHaveBeenCalled()
			expect(twoFactorServiceMock.enableTwoFactor).not.toHaveBeenCalled()
			expect(twoFactorServiceMock.generateBackupCodes).not.toHaveBeenCalled()
		})
	})

	describe('disable', () => {
		it('should disable 2FA only through the code-checking service path', async () => {
			twoFactorServiceMock.disableTwoFactor.mockResolvedValueOnce({
				message: '2FA disabled successfully',
			})

			const result = await controller.disable(makeRequest(), { code: '123456' })

			expect(twoFactorServiceMock.disableTwoFactor).toHaveBeenCalledWith('user-uuid-1', '123456')
			expect(result).toMatchObject({ message: expect.any(String) })
		})

		it('should propagate the service error when the code is invalid', async () => {
			twoFactorServiceMock.disableTwoFactor.mockRejectedValueOnce(
				new Error('Invalid verification code'),
			)

			await expect(controller.disable(makeRequest(), { code: '000000' })).rejects.toThrow(
				'Invalid verification code',
			)
		})
	})

	describe('verify', () => {
		it('should return valid: true when token is correct', async () => {
			twoFactorServiceMock.verifyToken.mockResolvedValueOnce(true)

			const result = await controller.verify(makeRequest(), '123456')

			expect(twoFactorServiceMock.verifyToken).toHaveBeenCalledWith('user-uuid-1', '123456')
			expect(result).toEqual({ valid: true })
		})

		it('should return valid: false when token is incorrect', async () => {
			twoFactorServiceMock.verifyToken.mockResolvedValueOnce(false)

			const result = await controller.verify(makeRequest(), '000000')

			expect(result).toEqual({ valid: false })
		})
	})

	describe('status', () => {
		it('should return 2FA enabled status and backup codes count', async () => {
			twoFactorServiceMock.isTwoFactorEnabled.mockResolvedValueOnce(true)
			twoFactorServiceMock.getRemainingBackupCodesCount.mockResolvedValueOnce(8)

			const result = await controller.status(makeRequest())

			expect(twoFactorServiceMock.isTwoFactorEnabled).toHaveBeenCalledWith('user-uuid-1')
			expect(twoFactorServiceMock.getRemainingBackupCodesCount).toHaveBeenCalledWith('user-uuid-1')
			expect(result).toEqual({ enabled: true, backupCodesRemaining: 8 })
		})
	})

	describe('verifyBackupCode', () => {
		it('should return valid: true when backup code is correct', async () => {
			twoFactorServiceMock.verifyBackupCode.mockResolvedValueOnce(true)

			const result = await controller.verifyBackupCode(makeRequest(), 'ABCD-1234')

			expect(twoFactorServiceMock.verifyBackupCode).toHaveBeenCalledWith('user-uuid-1', 'ABCD-1234')
			expect(result).toEqual(expect.objectContaining({ valid: true }))
		})

		it('should return valid: false when backup code is invalid or already used', async () => {
			twoFactorServiceMock.verifyBackupCode.mockResolvedValueOnce(false)

			const result = await controller.verifyBackupCode(makeRequest(), 'XXXX-9999')

			expect(result).toEqual(expect.objectContaining({ valid: false }))
		})
	})
})
