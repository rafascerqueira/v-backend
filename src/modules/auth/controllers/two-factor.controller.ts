import { Body, Controller, Get, Post, Request } from '@nestjs/common'
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import { TwoFactorService } from '../services/two-factor.service'

@ApiTags('auth')
@Controller('auth/2fa')
export class TwoFactorController {
	constructor(private readonly twoFactorService: TwoFactorService) {}

	@Post('generate')
	@ApiOperation({ summary: 'Generate 2FA secret and QR code' })
	async generateSecret(@Request() req: any) {
		return this.twoFactorService.generateSecret(req.user.sub)
	}

	@Post('setup')
	@ApiOperation({ summary: 'Generate 2FA secret and QR code (alias for generate)' })
	async setup(@Request() req: any) {
		return this.twoFactorService.generateSecret(req.user.sub)
	}

	@Post('enable')
	@ApiOperation({ summary: 'Enable 2FA with verification code' })
	@ApiBody({ schema: { example: { code: '123456' } } })
	async enable(@Request() req: any, @Body('code') code: string) {
		return this.twoFactorService.enableTwoFactor(req.user.sub, code)
	}

	@Post('disable')
	@ApiOperation({ summary: 'Disable 2FA' })
	async disable(@Request() req: any) {
		return this.twoFactorService.disableTwoFactorWithoutCode(req.user.sub)
	}

	@Post('verify')
	@Throttle({
		short: { ttl: 1000, limit: 1 },
		medium: { ttl: 60000, limit: 5 },
		long: { ttl: 3600000, limit: 10 },
	})
	@ApiOperation({ summary: 'Verify 2FA code' })
	@ApiBody({ schema: { example: { code: '123456' } } })
	async verify(@Request() req: any, @Body('code') code: string) {
		const isValid = await this.twoFactorService.verifyToken(req.user.sub, code)
		return { valid: isValid }
	}

	@Get('status')
	@ApiOperation({ summary: 'Check if 2FA is enabled' })
	async status(@Request() req: any) {
		const enabled = await this.twoFactorService.isTwoFactorEnabled(req.user.sub)
		const backupCodesRemaining = await this.twoFactorService.getRemainingBackupCodesCount(
			req.user.sub,
		)
		return { enabled, backupCodesRemaining }
	}

	@Post('backup-codes')
	@ApiOperation({ summary: 'Generate new backup codes (invalidates old ones)' })
	async generateBackupCodes(@Request() req: any) {
		const codes = await this.twoFactorService.generateBackupCodes(req.user.sub)
		return {
			codes,
			message: 'Guarde esses códigos em local seguro. Cada código só pode ser usado uma vez.',
		}
	}

	@Post('verify-backup')
	@Throttle({
		short: { ttl: 1000, limit: 1 },
		medium: { ttl: 60000, limit: 5 },
		long: { ttl: 3600000, limit: 10 },
	})
	@ApiOperation({ summary: 'Verify a backup code (for recovery)' })
	@ApiBody({ schema: { example: { code: 'ABCD-1234' } } })
	async verifyBackupCode(@Request() req: any, @Body('code') code: string) {
		const isValid = await this.twoFactorService.verifyBackupCode(req.user.sub, code)
		if (!isValid) {
			return { valid: false, message: 'Código inválido ou já utilizado' }
		}
		return { valid: true, message: 'Código verificado com sucesso' }
	}
}
