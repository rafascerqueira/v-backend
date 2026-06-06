import { Controller, Get, NotFoundException, Req, Res } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { AccountService } from '@/modules/users/services/account.service'
import { AUTH_COOKIES } from '../constants/cookies'
import { CurrentUser } from '../decorators/current-user.decorator'
import type { TokenPayload } from '../dto/auth-response.dto'
import { resolveAvatarUrl } from '../utils/avatar-url'
import { setCsrfCookie } from '../utils/csrf'

@ApiTags('auth')
@ApiBearerAuth()
@Controller('auth')
export class MeController {
	constructor(
		private readonly accountService: AccountService,
		private readonly configService: ConfigService,
	) {}

	@Get('me')
	@ApiOperation({ summary: 'Get current user data' })
	async me(
		@CurrentUser() user: TokenPayload,
		@Req() request: FastifyRequest,
		@Res({ passthrough: true }) reply: FastifyReply,
	) {
		const account = await this.accountService.findById(user.sub)

		if (!account) {
			throw new NotFoundException('User not found')
		}

		// Seed the CSRF cookie ONLY when absent. /auth/me is a read endpoint the SPA
		// calls repeatedly and concurrently (boot, refreshUser() after mutations, tab
		// focus, …). Rotating the token here caused a double-submit race: axios reads
		// document.cookie to build the X-CSRF-Token header, but the browser attaches
		// the Cookie header independently at send time. If a concurrent /auth/me
		// response rotated the cookie in that window, header (old) and cookie (new)
		// diverged → "Invalid or missing CSRF token" 403 with BOTH values present but
		// mismatched (exactly what prod logs showed on DELETE /auth/profile/avatar).
		// Rotation belongs at session boundaries only (login, token refresh), never on
		// a frequently-polled read.
		if (!request.cookies?.[AUTH_COOKIES.CSRF_TOKEN]) {
			setCsrfCookie(reply, 7 * 24 * 60 * 60)
		}

		const appUrl = this.configService.get<string>('appUrl', 'http://localhost:3001')

		return {
			id: account.id,
			name: account.name,
			email: account.email,
			role: account.role,
			planType: account.plan_type,
			avatar: resolveAvatarUrl(account.avatar, appUrl, account.updatedAt),
			phone: account.phone,
			address: account.address,
			two_factor_enabled: account.two_factor_enabled,
			createdAt: account.createdAt,
			updatedAt: account.updatedAt,
		}
	}
}
