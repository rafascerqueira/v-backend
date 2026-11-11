import { Controller, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { CurrentUser } from '../decorators/current-user.decorator'
import { Public } from '../decorators/public.decorator'
import { SkipCsrf } from '../decorators/skip-csrf.decorator'
import { SessionService } from '../services/session.service'
import type { AuthenticatedUser } from '../session/session.types'
import { clearSessionCookies, readSessionCookies } from '../utils/session-cookies'

@ApiTags('auth')
@Controller('auth')
export class LogoutController {
	constructor(private readonly sessionService: SessionService) {}

	@Post('logout')
	// Signing out must work whatever state the session is in (access token expired,
	// CSRF cookie gone, session already ended elsewhere), so the route is public and
	// CSRF-exempt: it only ever ends the session its own cookies point to, and always
	// clears them. A forged logout is a nuisance, never a data or integrity risk.
	@Public()
	@SkipCsrf()
	@HttpCode(HttpStatus.OK)
	@ApiOperation({ summary: 'End the current session' })
	@ApiResponse({ status: 200, description: 'Session ended; cookies cleared' })
	async handle(@Req() request: FastifyRequest, @Res({ passthrough: true }) response: FastifyReply) {
		const authorization = request.headers.authorization
		const bearer = authorization?.startsWith('Bearer ') ? authorization.substring(7) : undefined
		const cookies = readSessionCookies(request)

		try {
			await this.sessionService.revokeByTokens({
				accessToken: bearer ?? cookies.accessToken,
				refreshToken: cookies.refreshToken,
			})
		} finally {
			clearSessionCookies(response)
		}

		return { message: 'Logout successful' }
	}

	@Post('logout-all')
	@HttpCode(HttpStatus.OK)
	@ApiBearerAuth()
	@ApiOperation({ summary: 'End every session of the account, this one included' })
	@ApiResponse({ status: 200, description: 'All sessions ended; cookies cleared' })
	async logoutAll(
		@CurrentUser() user: AuthenticatedUser,
		@Res({ passthrough: true }) response: FastifyReply,
	) {
		await this.sessionService.revokeAllForAccount(user.sub)
		await this.sessionService.revoke(user.sid)
		clearSessionCookies(response)
		return { message: 'Todas as sessões foram encerradas' }
	}
}
