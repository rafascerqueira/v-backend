import {
	Body,
	Controller,
	HttpCode,
	HttpStatus,
	Post,
	Req,
	Res,
	UnauthorizedException,
	UseGuards,
} from '@nestjs/common'
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { Public } from '@/modules/auth/decorators/public.decorator'
import { OriginGuard } from '@/modules/auth/guards/origin.guard'
import { SessionService } from '@/modules/auth/services/session.service'
import { TwoFactorService } from '@/modules/auth/services/two-factor.service'
import { setSessionCookies } from '@/modules/auth/utils/session-cookies'
import { ZodValidationPipe } from '@/shared/pipes/zod-validation.pipe'
import { type LoginDto, loginSchema } from '../dto/login.dto'
import { AccountService } from '../services/account.service'

@ApiTags('auth')
@Controller('auth')
export class LoginController {
	constructor(
		private readonly accountService: AccountService,
		private readonly sessionService: SessionService,
		private readonly twoFactorService: TwoFactorService,
	) {}

	@Post('login')
	@Public()
	// Login is CSRF-exempt (there is no session yet); a cross-site page is stopped by
	// its Origin instead.
	@UseGuards(OriginGuard)
	@Throttle({
		short: { ttl: 1000, limit: 1 },
		medium: { ttl: 60000, limit: 5 },
		long: { ttl: 3600000, limit: 20 },
	})
	@HttpCode(HttpStatus.OK)
	@ApiOperation({ summary: 'User login' })
	@ApiResponse({ status: 200, description: 'Login successful; session cookies set' })
	@ApiResponse({ status: 401, description: 'Invalid credentials' })
	@ApiResponse({ status: 403, description: 'ORIGIN_NOT_ALLOWED' })
	@ApiBody({
		schema: {
			example: {
				email: 'john@example.com',
				password: 'Password123',
			},
		},
	})
	async handle(
		@Body(new ZodValidationPipe(loginSchema)) body: LoginDto,
		@Req() request: FastifyRequest,
		@Res({ passthrough: true }) response: FastifyReply,
	) {
		const { email, password } = body

		const account = await this.accountService.findByEmail(email)

		if (!account) {
			throw new UnauthorizedException('Invalid e-mail or password')
		}

		const isPasswordValid = await this.accountService.verifyPassword(
			password,
			account.password,
			account.salt,
		)

		if (!isPasswordValid) {
			throw new UnauthorizedException('Invalid e-mail or password')
		}

		// Accounts deactivated/suspended by an admin must not start new sessions.
		// (Checked after the password so the response doesn't reveal which emails exist.)
		if (account.is_active === false) {
			throw new UnauthorizedException('Conta desativada. Entre em contato com o suporte.')
		}

		// Check if 2FA is enabled
		if (account.two_factor_enabled) {
			const twoFactorToken = body.twoFactorToken

			if (!twoFactorToken) {
				return {
					requiresTwoFactor: true,
					message: 'Please provide your 2FA code',
				}
			}

			const isValidToken = await this.twoFactorService.verifyToken(account.id, twoFactorToken)

			if (!isValidToken) {
				throw new UnauthorizedException('Invalid 2FA code')
			}
		}

		// Update last login timestamp
		await this.accountService.updateLastLogin(account.id)

		// The tokens travel only in HttpOnly cookies; the body never carries them.
		const session = await this.sessionService.create(account, { persistent: body.remember })
		setSessionCookies(request, response, session)

		return { expiresIn: session.expiresIn }
	}
}
