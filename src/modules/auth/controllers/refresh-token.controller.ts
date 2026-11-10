import { Controller, HttpCode, HttpStatus, Post, Req, Res, UseGuards } from '@nestjs/common'
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { Public } from '../decorators/public.decorator'
import { SkipCsrf } from '../decorators/skip-csrf.decorator'
import type { AuthResponseDto } from '../dto/auth-response.dto'
import { OriginGuard } from '../guards/origin.guard'
import { SessionService } from '../services/session.service'
import { SESSION_ERROR_CODE, SessionException } from '../session/session.errors'
import {
	clearSessionCookies,
	readSessionCookies,
	setSessionCookies,
} from '../utils/session-cookies'

@ApiTags('auth')
@Controller('auth')
export class RefreshTokenController {
	constructor(private readonly sessionService: SessionService) {}

	@Post('refresh')
	@Public()
	// The refresh must keep working when the access token (and with it the CSRF cookie)
	// has expired, so it cannot depend on the double-submit token. Cross-site abuse is
	// stopped by OriginGuard instead, and the refresh token is read from the HttpOnly
	// cookie only: nothing a page script can supply is accepted.
	@SkipCsrf()
	@UseGuards(OriginGuard)
	@Throttle({
		short: { ttl: 1000, limit: 1 },
		medium: { ttl: 60000, limit: 10 },
		long: { ttl: 3600000, limit: 30 },
	})
	@HttpCode(HttpStatus.OK)
	@ApiOperation({ summary: 'Renew the session from the refresh cookie' })
	@ApiResponse({ status: 200, description: 'Session renewed; new cookies set' })
	@ApiResponse({
		status: 401,
		description: 'SESSION_EXPIRED, SESSION_REVOKED or ACCOUNT_INACTIVE (see `code`)',
	})
	@ApiResponse({ status: 403, description: 'ORIGIN_NOT_ALLOWED' })
	async handle(
		@Req() request: FastifyRequest,
		@Res({ passthrough: true }) response: FastifyReply,
	): Promise<AuthResponseDto> {
		const { refreshToken } = readSessionCookies(request)

		try {
			if (!refreshToken) {
				throw new SessionException(SESSION_ERROR_CODE.EXPIRED)
			}
			const session = await this.sessionService.refresh(refreshToken)
			setSessionCookies(request, response, session)
			return { expiresIn: session.expiresIn }
		} catch (error) {
			// The session is over: drop the cookies so the client stops presenting them.
			// (A store outage is not a verdict on the session; the cookies stay.)
			if (error instanceof SessionException) {
				clearSessionCookies(response)
			}
			throw error
		}
	}
}
