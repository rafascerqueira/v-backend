import { Body, Controller, Get, NotFoundException, Post, Request } from '@nestjs/common'
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import { ZodValidationPipe } from '@/shared/pipes/zod-validation.pipe'
import { type TwoFactorCodeDto, twoFactorCodeSchema } from '../dto/two-factor-code.dto'
import { TwoFactorService } from '../services/two-factor.service'

/**
 * Brute-force budget for endpoints that check a TOTP/backup code. Note: the
 * default throttler tracker is the client IP and the key includes the handler,
 * so this is per IP *and* per endpoint, not per account (per-account lockout +
 * TOTP replay protection are tracked in docs/BACKLOG.md "Complete 2FA").
 */
const CODE_CHECK_THROTTLE = {
	short: { ttl: 1000, limit: 1 },
	medium: { ttl: 60000, limit: 5 },
	long: { ttl: 3600000, limit: 10 },
}

/**
 * 2FA enrollment is closed until the full flow ships (login code step in the
 * frontend, enable/backup-codes UI, encrypted secret — see docs/BACKLOG.md).
 * Today the frontend ignores `requiresTwoFactor` on login, so enrolling locks
 * the account out, and a stolen session could enroll its own secret to lock
 * the owner out. Accounts that already have 2FA keep the login challenge and
 * can still disable it with a valid code. Flip this when the flow is complete.
 */
const TWO_FACTOR_ENROLLMENT_OPEN = false

@ApiTags('auth')
@Controller('auth/2fa')
export class TwoFactorController {
	constructor(private readonly twoFactorService: TwoFactorService) {}

	private assertEnrollmentOpen(): void {
		if (!TWO_FACTOR_ENROLLMENT_OPEN) throw new NotFoundException()
	}

	@Post('generate')
	@ApiOperation({ summary: 'Generate 2FA secret and QR code (enrollment currently closed: 404)' })
	async generateSecret(@Request() req: any) {
		this.assertEnrollmentOpen()
		return this.twoFactorService.generateSecret(req.user.sub)
	}

	@Post('setup')
	@ApiOperation({ summary: 'Alias for generate (enrollment currently closed: 404)' })
	async setup(@Request() req: any) {
		this.assertEnrollmentOpen()
		return this.twoFactorService.generateSecret(req.user.sub)
	}

	@Post('enable')
	@ApiOperation({ summary: 'Enable 2FA with verification code (enrollment currently closed: 404)' })
	@ApiBody({ schema: { example: { code: '123456' } } })
	async enable(@Request() req: any, @Body('code') code: string) {
		this.assertEnrollmentOpen()
		return this.twoFactorService.enableTwoFactor(req.user.sub, code)
	}

	@Post('disable')
	@Throttle(CODE_CHECK_THROTTLE)
	@ApiOperation({ summary: 'Disable 2FA (requires a valid authenticator code)' })
	@ApiBody({ schema: { example: { code: '123456' } } })
	async disable(
		@Request() req: any,
		@Body(new ZodValidationPipe(twoFactorCodeSchema)) body: TwoFactorCodeDto,
	) {
		return this.twoFactorService.disableTwoFactor(req.user.sub, body.code)
	}

	@Post('verify')
	@Throttle(CODE_CHECK_THROTTLE)
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
	@ApiOperation({
		summary: 'Generate new backup codes, invalidating old ones (enrollment currently closed: 404)',
	})
	async generateBackupCodes(@Request() req: any) {
		this.assertEnrollmentOpen()
		const codes = await this.twoFactorService.generateBackupCodes(req.user.sub)
		return {
			codes,
			message: 'Guarde esses códigos em local seguro. Cada código só pode ser usado uma vez.',
		}
	}

	@Post('verify-backup')
	@Throttle(CODE_CHECK_THROTTLE)
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
