/**
 * TwoFactorController unit tests
 * Covers: POST /auth/2fa/generate, enable, disable, verify, GET status,
 *         POST backup-codes, POST verify-backup
 * Guards mocked: JwtAuthGuard
 */

import { Test } from '@nestjs/testing'
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard'
import { TwoFactorService } from '../services/two-factor.service'
import { TwoFactorController } from './two-factor.controller'

const twoFactorServiceMock = {
	generateSecret: jest.fn(),
	enableTwoFactor: jest.fn(),
	disableTwoFactor: jest.fn(),
	disableTwoFactorWithoutCode: jest.fn(),
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

	describe('generateSecret', () => {
		it('should call service.generateSecret with user sub', async () => {
			const secretData = { secret: 'BASE32SECRET', qrCode: 'data:image/png;base64,...' }
			twoFactorServiceMock.generateSecret.mockResolvedValueOnce(secretData)

			const result = await controller.generateSecret(makeRequest())

			expect(twoFactorServiceMock.generateSecret).toHaveBeenCalledWith('user-uuid-1')
			expect(result).toEqual(secretData)
		})
	})

	describe('setup', () => {
		it('should call service.generateSecret with user sub (alias for generate)', async () => {
			const secretData = { secret: 'BASE32SECRET', qrCode: 'data:image/png;base64,...' }
			twoFactorServiceMock.generateSecret.mockResolvedValueOnce(secretData)

			const result = await controller.setup(makeRequest())

			expect(twoFactorServiceMock.generateSecret).toHaveBeenCalledWith('user-uuid-1')
			expect(result).toEqual(secretData)
		})

		it('should propagate errors from the service', async () => {
			twoFactorServiceMock.generateSecret.mockRejectedValueOnce(new Error('Service unavailable'))

			await expect(controller.setup(makeRequest())).rejects.toThrow('Service unavailable')
		})
	})

	describe('enable', () => {
		it('should enable 2FA when valid token provided', async () => {
			twoFactorServiceMock.enableTwoFactor.mockResolvedValueOnce({ enabled: true })

			const result = await controller.enable(makeRequest(), '123456')

			expect(twoFactorServiceMock.enableTwoFactor).toHaveBeenCalledWith('user-uuid-1', '123456')
			expect(result).toEqual({ enabled: true })
		})

		it('should propagate error from service when token is invalid', async () => {
			twoFactorServiceMock.enableTwoFactor.mockRejectedValueOnce(new Error('Invalid token'))

			await expect(controller.enable(makeRequest(), '000000')).rejects.toThrow('Invalid token')
		})
	})

	describe('disable', () => {
		it('should disable 2FA for the authenticated user', async () => {
			twoFactorServiceMock.disableTwoFactorWithoutCode.mockResolvedValueOnce({
				message: '2FA disabled successfully',
			})

			const result = await controller.disable(makeRequest())

			expect(twoFactorServiceMock.disableTwoFactorWithoutCode).toHaveBeenCalledWith('user-uuid-1')
			expect(result).toMatchObject({ message: expect.any(String) })
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

	describe('generateBackupCodes', () => {
		it('should return new backup codes with instructions message', async () => {
			const codes = ['ABCD-1234', 'EFGH-5678']
			twoFactorServiceMock.generateBackupCodes.mockResolvedValueOnce(codes)

			const result = await controller.generateBackupCodes(makeRequest())

			expect(twoFactorServiceMock.generateBackupCodes).toHaveBeenCalledWith('user-uuid-1')
			expect(result).toMatchObject({ codes })
			expect(typeof result.message).toBe('string')
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
