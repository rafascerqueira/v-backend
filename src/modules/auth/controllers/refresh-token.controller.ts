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
import type { FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import { TokenService } from '../services/token.service'
import { ZodValidationPipe } from '@/shared/pipes/zod-validation.pipe'
import { Public } from '../decorators/public.decorator'
import { AUTH_COOKIES, COOKIE_OPTIONS } from '../constants/cookies'

const refreshTokenSchema = z.object({
	refreshToken: z.string().optional(),
})

type RefreshTokenDto = z.infer<typeof refreshTokenSchema>

@ApiTags('auth')
@Controller('auth')
export class RefreshTokenController {
	constructor(private readonly tokenService: TokenService) {}

	@Post('refresh')
	@Public()
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
			const tokens = await this.tokenService.refreshTokens(refreshToken)

			response.setCookie(AUTH_COOKIES.ACCESS_TOKEN, tokens.accessToken, {
				...COOKIE_OPTIONS,
				maxAge: tokens.expiresIn,
			})

			response.setCookie(AUTH_COOKIES.REFRESH_TOKEN, tokens.refreshToken, {
				...COOKIE_OPTIONS,
				maxAge: 7 * 24 * 60 * 60,
			})

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
