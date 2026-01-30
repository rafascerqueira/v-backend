import { Body, Controller, Get, Post, Request } from '@nestjs/common'
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger'
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

	@Post('enable')
	@ApiOperation({ summary: 'Enable 2FA with verification code' })
	@ApiBody({ schema: { example: { token: '123456' } } })
	async enable(@Request() req: any, @Body('token') token: string) {
		return this.twoFactorService.enableTwoFactor(req.user.sub, token)
	}

	@Post('disable')
	@ApiOperation({ summary: 'Disable 2FA with verification code' })
	@ApiBody({ schema: { example: { token: '123456' } } })
	async disable(@Request() req: any, @Body('token') token: string) {
		return this.twoFactorService.disableTwoFactor(req.user.sub, token)
	}

	@Post('verify')
	@ApiOperation({ summary: 'Verify 2FA token' })
	@ApiBody({ schema: { example: { token: '123456' } } })
	async verify(@Request() req: any, @Body('token') token: string) {
		const isValid = await this.twoFactorService.verifyToken(req.user.sub, token)
		return { valid: isValid }
	}

	@Get('status')
	@ApiOperation({ summary: 'Check if 2FA is enabled' })
	async status(@Request() req: any) {
		const enabled = await this.twoFactorService.isTwoFactorEnabled(req.user.sub)
		const backupCodesRemaining = await this.twoFactorService.getRemainingBackupCodesCount(req.user.sub)
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
