/**
 * TwoFactorService unit tests
 * Covers: generateSecret, enableTwoFactor, disableTwoFactor, verifyToken,
 *         isTwoFactorEnabled, generateBackupCodes, verifyBackupCode
 * Verifies: error paths (not found, already enabled, not enabled, bad token),
 *           backup code hashing and removal on use
 */
import { BadRequestException } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import {
	TWO_FACTOR_REPOSITORY,
	type TwoFactorRepository,
} from '@/shared/repositories/two-factor.repository'
import { TwoFactorService } from './two-factor.service'

const repositoryMock: jest.Mocked<TwoFactorRepository> = {
	findAccountEmailAnd2fa: jest.fn(),
	findAccount2faSecret: jest.fn(),
	findAccount2faBackup: jest.fn(),
	findAccount2faEnabled: jest.fn(),
	updateTwoFactorSecret: jest.fn(),
	enableTwoFactor: jest.fn(),
	disableTwoFactor: jest.fn(),
	updateBackupCodes: jest.fn(),
	findBackupCodesCount: jest.fn(),
}

// Mock otpauth and qrcode since we test the service logic, not OTP generation
jest.mock('otpauth', () => ({
	TOTP: jest.fn().mockImplementation(() => ({
		toString: () => 'otpauth://totp/test',
		validate: jest.fn().mockReturnValue(0),
	})),
	Secret: jest.fn().mockImplementation(() => ({
		base32: 'JBSWY3DPEHPK3PXP',
	})),
}))

jest.mock('qrcode', () => ({
	toDataURL: jest.fn().mockResolvedValue('data:image/png;base64,fake'),
}))

describe('TwoFactorService', () => {
	let service: TwoFactorService

	beforeEach(async () => {
		const module = await Test.createTestingModule({
			providers: [TwoFactorService, { provide: TWO_FACTOR_REPOSITORY, useValue: repositoryMock }],
		}).compile()

		service = module.get(TwoFactorService)
		jest.clearAllMocks()
	})

	describe('generateSecret', () => {
		it('should throw when user not found', async () => {
			repositoryMock.findAccountEmailAnd2fa.mockResolvedValueOnce(null)

			await expect(service.generateSecret('uid')).rejects.toThrow(BadRequestException)
		})

		it('should throw when 2FA is already enabled', async () => {
			repositoryMock.findAccountEmailAnd2fa.mockResolvedValueOnce({
				email: 'u@t.com',
				two_factor_enabled: true,
			})

			await expect(service.generateSecret('uid')).rejects.toThrow(BadRequestException)
		})

		it('should store secret and return QR code data when user is eligible', async () => {
			repositoryMock.findAccountEmailAnd2fa.mockResolvedValueOnce({
				email: 'u@t.com',
				two_factor_enabled: false,
			})
			repositoryMock.updateTwoFactorSecret.mockResolvedValueOnce(undefined)

			const result = await service.generateSecret('uid')

			expect(repositoryMock.updateTwoFactorSecret).toHaveBeenCalledWith('uid', expect.any(String))
			expect(result.secret).toBeTruthy()
			expect(result.qrCode).toMatch(/^data:image/)
			expect(result.otpauthUrl).toBeTruthy()
		})
	})

	describe('enableTwoFactor', () => {
		it('should throw when user not found', async () => {
			repositoryMock.findAccount2faSecret.mockResolvedValueOnce(null)

			await expect(service.enableTwoFactor('uid', '123456')).rejects.toThrow(BadRequestException)
		})

		it('should throw when 2FA already enabled', async () => {
			repositoryMock.findAccount2faSecret.mockResolvedValueOnce({
				two_factor_secret: 'secret',
				two_factor_enabled: true,
			})

			await expect(service.enableTwoFactor('uid', '123456')).rejects.toThrow(BadRequestException)
		})

		it('should throw when secret not set', async () => {
			repositoryMock.findAccount2faSecret.mockResolvedValueOnce({
				two_factor_secret: null,
				two_factor_enabled: false,
			})

			await expect(service.enableTwoFactor('uid', '123456')).rejects.toThrow(BadRequestException)
		})

		it('should throw when token is invalid', async () => {
			// Mock otpauth TOTP to return null (invalid)
			const OTPAuth = require('otpauth')
			OTPAuth.TOTP.mockImplementationOnce(() => ({
				toString: () => 'otpauth://totp/test',
				validate: jest.fn().mockReturnValue(null),
			}))

			repositoryMock.findAccount2faSecret.mockResolvedValueOnce({
				two_factor_secret: 'VALID_SECRET',
				two_factor_enabled: false,
			})

			await expect(service.enableTwoFactor('uid', '000000')).rejects.toThrow(BadRequestException)
		})

		it('should enable 2FA and return success message when token is valid', async () => {
			// OTPAuth mock already returns 0 (valid) for validate
			repositoryMock.findAccount2faSecret.mockResolvedValueOnce({
				two_factor_secret: 'VALID_SECRET',
				two_factor_enabled: false,
			})
			repositoryMock.enableTwoFactor.mockResolvedValueOnce(undefined)

			const result = await service.enableTwoFactor('uid', '123456')

			expect(repositoryMock.enableTwoFactor).toHaveBeenCalledWith('uid')
			expect(result.message).toBeTruthy()
		})
	})

	describe('disableTwoFactor', () => {
		it('should throw when user not found', async () => {
			repositoryMock.findAccount2faSecret.mockResolvedValueOnce(null)

			await expect(service.disableTwoFactor('uid', '123456')).rejects.toThrow(BadRequestException)
		})

		it('should throw when 2FA is not enabled', async () => {
			repositoryMock.findAccount2faSecret.mockResolvedValueOnce({
				two_factor_secret: 'secret',
				two_factor_enabled: false,
			})

			await expect(service.disableTwoFactor('uid', '123456')).rejects.toThrow(BadRequestException)
		})

		it('should disable 2FA when token is valid', async () => {
			repositoryMock.findAccount2faSecret.mockResolvedValueOnce({
				two_factor_secret: 'VALID_SECRET',
				two_factor_enabled: true,
			})
			repositoryMock.disableTwoFactor.mockResolvedValueOnce(undefined)

			const result = await service.disableTwoFactor('uid', '123456')

			expect(repositoryMock.disableTwoFactor).toHaveBeenCalledWith('uid')
			expect(result.message).toBeTruthy()
		})
	})

	describe('verifyToken', () => {
		it('should return false when user not found', async () => {
			repositoryMock.findAccount2faSecret.mockResolvedValueOnce(null)

			const result = await service.verifyToken('uid', '123456')

			expect(result).toBe(false)
		})

		it('should return false when 2FA is not enabled', async () => {
			repositoryMock.findAccount2faSecret.mockResolvedValueOnce({
				two_factor_secret: 'secret',
				two_factor_enabled: false,
			})

			const result = await service.verifyToken('uid', '123456')

			expect(result).toBe(false)
		})

		it('should return true when token validates successfully', async () => {
			repositoryMock.findAccount2faSecret.mockResolvedValueOnce({
				two_factor_secret: 'VALID_SECRET',
				two_factor_enabled: true,
			})

			const result = await service.verifyToken('uid', '123456')

			expect(result).toBe(true)
		})
	})

	describe('isTwoFactorEnabled', () => {
		it('should delegate to repository', async () => {
			repositoryMock.findAccount2faEnabled.mockResolvedValueOnce(true)

			const result = await service.isTwoFactorEnabled('uid')

			expect(repositoryMock.findAccount2faEnabled).toHaveBeenCalledWith('uid')
			expect(result).toBe(true)
		})
	})

	describe('generateBackupCodes', () => {
		it('should generate 10 codes and store hashed versions', async () => {
			repositoryMock.updateBackupCodes.mockResolvedValueOnce(undefined)

			const codes = await service.generateBackupCodes('uid')

			expect(codes).toHaveLength(10)
			// Each code should be in format XXXX-XXXX
			for (const code of codes) {
				expect(code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/)
			}
			// Stored codes should be hashed (not the raw codes)
			const storedCodes: string[] = repositoryMock.updateBackupCodes.mock.calls[0][1]
			for (let i = 0; i < codes.length; i++) {
				expect(storedCodes[i]).not.toBe(codes[i])
				expect(storedCodes[i]).toHaveLength(64) // SHA-256 hex
			}
		})
	})

	describe('verifyBackupCode', () => {
		it('should return false when user not found', async () => {
			repositoryMock.findAccount2faBackup.mockResolvedValueOnce(null)

			const result = await service.verifyBackupCode('uid', 'ABCD-EFGH')

			expect(result).toBe(false)
		})

		it('should return false when 2FA is not enabled', async () => {
			repositoryMock.findAccount2faBackup.mockResolvedValueOnce({
				two_factor_backup: [],
				two_factor_enabled: false,
			})

			const result = await service.verifyBackupCode('uid', 'ABCD-EFGH')

			expect(result).toBe(false)
		})

		it('should return false when code is not in backup list', async () => {
			const { createHash } = require('node:crypto')
			const wrongHash = createHash('sha256').update('WRONGCODE').digest('hex')
			repositoryMock.findAccount2faBackup.mockResolvedValueOnce({
				two_factor_backup: [wrongHash],
				two_factor_enabled: true,
			})

			const result = await service.verifyBackupCode('uid', 'ABCD-EFGH')

			expect(result).toBe(false)
		})

		it('should return true and remove the used code from backup list', async () => {
			const { createHash } = require('node:crypto')
			const code = 'ABCDEFGH'
			const hash = createHash('sha256').update(code).digest('hex')
			repositoryMock.findAccount2faBackup.mockResolvedValueOnce({
				two_factor_backup: [hash, 'other-hash'],
				two_factor_enabled: true,
			})
			repositoryMock.updateBackupCodes.mockResolvedValueOnce(undefined)

			const result = await service.verifyBackupCode('uid', 'ABCD-EFGH')

			expect(result).toBe(true)
			// The used code should be removed from the stored list
			const updatedCodes: string[] = repositoryMock.updateBackupCodes.mock.calls[0][1]
			expect(updatedCodes).not.toContain(hash)
			expect(updatedCodes).toContain('other-hash')
		})
	})

	describe('getRemainingBackupCodesCount', () => {
		it('should delegate to repository', async () => {
			repositoryMock.findBackupCodesCount.mockResolvedValueOnce(8)

			const result = await service.getRemainingBackupCodesCount('uid')

			expect(result).toBe(8)
		})
	})
})
