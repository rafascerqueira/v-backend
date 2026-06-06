import {
	Body,
	Controller,
	HttpCode,
	HttpStatus,
	Post,
	Req,
	Res,
	UnauthorizedException,
} from '@nestjs/common'
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { ZodValidationPipe } from '@/shared/pipes/zod-validation.pipe'
import { AUTH_COOKIES, COOKIE_OPTIONS } from '../constants/cookies'
import { Public } from '../decorators/public.decorator'
import { SkipCsrf } from '../decorators/skip-csrf.decorator'
import { TokenService } from '../services/token.service'
import { TokenBlacklistService } from '../services/token-blacklist.service'
import { setCsrfCookie } from '../utils/csrf'

const refreshTokenSchema = z.object({
	refreshToken: z.string().optional(),
})

type RefreshTokenDto = z.infer<typeof refreshTokenSchema>

@ApiTags('auth')
@Controller('auth')
export class RefreshTokenController {
	constructor(
		private readonly tokenService: TokenService,
		private readonly tokenBlacklistService: TokenBlacklistService,
	) {}

	@Post('refresh')
	@Public()
	// Token rotation is gated by the HttpOnly refresh token, not an ambient form
	// post, and must keep working even when the access-token session has expired
	// (so the CSRF cookie may be gone). A forged refresh only rotates tokens —
	// no state to abuse — so this endpoint is intentionally CSRF-exempt.
	@SkipCsrf()
	@Throttle({
		short: { ttl: 1000, limit: 1 },
		medium: { ttl: 60000, limit: 10 },
		long: { ttl: 3600000, limit: 30 },
	})
	@HttpCode(HttpStatus.OK)
	@ApiOperation({ summary: 'Refresh access token' })
	@ApiResponse({ status: 200, description: 'Tokens refreshed successfully' })
	@ApiResponse({ status: 401, description: 'Invalid refresh token' })
	@ApiBody({
		schema: {
			example: {
				refreshToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
			},
		},
	})
	async handle(
		@Body(new ZodValidationPipe(refreshTokenSchema)) body: RefreshTokenDto,
		@Req() request: FastifyRequest,
		@Res({ passthrough: true }) response: FastifyReply,
	) {
		const refreshToken = this.extractRefreshToken(body, request)

		if (!refreshToken) {
			throw new UnauthorizedException('Refresh token not provided')
		}

		try {
			const tokens = await this.tokenService.refreshTokens(refreshToken, this.tokenBlacklistService)

			response.setCookie(AUTH_COOKIES.ACCESS_TOKEN, tokens.accessToken, {
				...COOKIE_OPTIONS,
				maxAge: tokens.expiresIn,
			})

			response.setCookie(AUTH_COOKIES.REFRESH_TOKEN, tokens.refreshToken, {
				...COOKIE_OPTIONS,
				maxAge: 7 * 24 * 60 * 60,
			})

			// Rotate the CSRF token together with the session. Its lifetime must match
			// the refresh token (7d), not the short-lived access token — otherwise the
			// CSRF cookie expires while the session is still silently renewable, and the
			// next mutation submits an empty header → 403.
			setCsrfCookie(response, 7 * 24 * 60 * 60)

			return tokens
		} catch {
			throw new UnauthorizedException('Invalid or expired refresh token')
		}
	}

	private extractRefreshToken(body: RefreshTokenDto, request: FastifyRequest): string | null {
		// Try body first (for API clients)
		if (body.refreshToken) {
			return body.refreshToken
		}

		// Try HttpOnly cookie
		const cookies = request.cookies
		if (cookies?.[AUTH_COOKIES.REFRESH_TOKEN]) {
			return cookies[AUTH_COOKIES.REFRESH_TOKEN] ?? null
		}

		return null
	}
}
