import {
	Body,
	Controller,
	HttpCode,
	HttpStatus,
	Post,
	Res,
	UnauthorizedException,
} from '@nestjs/common'
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import type { FastifyReply } from 'fastify'
import { z } from 'zod'
import { TokenService } from '../services/token.service'
import { ZodValidationPipe } from '@/shared/pipes/zod-validation.pipe'
import { Public } from '../decorators/public.decorator'
import { AUTH_COOKIES, COOKIE_OPTIONS } from '../constants/cookies'

const refreshTokenSchema = z.object({
	refreshToken: z.string().min(1, 'Refresh token é obrigatório'),
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
		@Res({ passthrough: true }) response: FastifyReply,
	) {
		try {
			const tokens = await this.tokenService.refreshTokens(body.refreshToken)

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
}
