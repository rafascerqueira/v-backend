import { BadRequestException, Inject, Injectable } from '@nestjs/common'
import * as OTPAuth from 'otpauth'
import {
	TWO_FACTOR_REPOSITORY,
	type TwoFactorRepository,
} from '@/shared/repositories/two-factor.repository'

const authenticator = {
	generateSecret: () => {
		const bytes = new Uint8Array(20)
		crypto.getRandomValues(bytes)
		return Array.from(bytes)
			.map((b) => b.toString(16).padStart(2, '0'))
			.join('')
	},
	keyuri: (email: string, issuer: string, secret: string) => {
		const totp = new OTPAuth.TOTP({ issuer, label: email, secret })
		return totp.toString()
	},
	verify: ({ token, secret }: { token: string; secret: string }) => {
		const totp = new OTPAuth.TOTP({ secret })
		return totp.validate({ token, window: 1 }) !== null
	},
}

import * as QRCode from 'qrcode'

@Injectable()
export class TwoFactorService {
	private readonly APP_NAME = 'Vendinhas'

	constructor(
		@Inject(TWO_FACTOR_REPOSITORY)
		private readonly twoFactorRepository: TwoFactorRepository,
	) {}

	async generateSecret(userId: string) {
		const user = await this.twoFactorRepository.findAccountEmailAnd2fa(userId)

		if (!user) {
			throw new BadRequestException('User not found')
		}

		if (user.two_factor_enabled) {
			throw new BadRequestException('2FA is already enabled')
		}

		const secret = authenticator.generateSecret()
		const otpauthUrl = authenticator.keyuri(user.email, this.APP_NAME, secret)

		await this.twoFactorRepository.updateTwoFactorSecret(userId, secret)

		const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl)

		return {
			secret,
			qrCode: qrCodeDataUrl,
			otpauthUrl,
		}
	}

	async enableTwoFactor(userId: string, token: string) {
		const user = await this.twoFactorRepository.findAccount2faSecret(userId)

		if (!user) {
			throw new BadRequestException('User not found')
		}

		if (user.two_factor_enabled) {
			throw new BadRequestException('2FA is already enabled')
		}

		if (!user.two_factor_secret) {
			throw new BadRequestException('Generate a secret first')
		}

		const isValid = authenticator.verify({
			token,
			secret: user.two_factor_secret,
		})

		if (!isValid) {
			throw new BadRequestException('Invalid verification code')
		}

		await this.twoFactorRepository.enableTwoFactor(userId)

		return { message: '2FA enabled successfully' }
	}

	async disableTwoFactor(userId: string, token: string) {
		const user = await this.twoFactorRepository.findAccount2faSecret(userId)

		if (!user) {
			throw new BadRequestException('User not found')
		}

		if (!user.two_factor_enabled) {
			throw new BadRequestException('2FA is not enabled')
		}

		if (!user.two_factor_secret) {
			throw new BadRequestException('2FA secret not configured')
		}

		const isValid = authenticator.verify({
			token,
			secret: user.two_factor_secret,
		})

		if (!isValid) {
			throw new BadRequestException('Invalid verification code')
		}

		await this.twoFactorRepository.disableTwoFactor(userId)

		return { message: '2FA disabled successfully' }
	}

	async verifyToken(userId: string, token: string): Promise<boolean> {
		const user = await this.twoFactorRepository.findAccount2faSecret(userId)

		if (!user || !user.two_factor_enabled || !user.two_factor_secret) {
			return false
		}

		return authenticator.verify({
			token,
			secret: user.two_factor_secret,
		})
	}

	async isTwoFactorEnabled(userId: string): Promise<boolean> {
		return this.twoFactorRepository.findAccount2faEnabled(userId)
	}

	async generateBackupCodes(userId: string): Promise<string[]> {
		const codes: string[] = []
		for (let i = 0; i < 10; i++) {
			const code = this.generateRandomCode()
			codes.push(code)
		}

		// Hash codes before storing
		const hashedCodes = codes.map((code) => this.hashCode(code))

		await this.twoFactorRepository.updateBackupCodes(userId, hashedCodes)

		return codes
	}

	async verifyBackupCode(userId: string, code: string): Promise<boolean> {
		const user = await this.twoFactorRepository.findAccount2faBackup(userId)

		if (!user || !user.two_factor_enabled) {
			return false
		}

		const hashedInput = this.hashCode(code.replace(/-/g, ''))
		const backupCodes = user.two_factor_backup as string[]

		const codeIndex = backupCodes.indexOf(hashedInput)

		if (codeIndex === -1) {
			return false
		}

		// Remove used code
		const updatedCodes = [...backupCodes]
		updatedCodes.splice(codeIndex, 1)

		await this.twoFactorRepository.updateBackupCodes(userId, updatedCodes)

		return true
	}

	async getRemainingBackupCodesCount(userId: string): Promise<number> {
		return this.twoFactorRepository.findBackupCodesCount(userId)
	}

	private generateRandomCode(): string {
		const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
		const bytes = new Uint8Array(8)
		crypto.getRandomValues(bytes)
		let code = ''
		for (let i = 0; i < 8; i++) {
			code += chars[bytes[i] % chars.length]
		}
		return `${code.slice(0, 4)}-${code.slice(4)}`
	}

	private hashCode(code: string): string {
		const { createHash } = require('node:crypto')
		return createHash('sha256').update(code.replace(/-/g, '')).digest('hex')
	}
}
