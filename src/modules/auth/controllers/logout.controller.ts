import {
	Controller,
	HttpCode,
	HttpStatus,
	Post,
	Headers,
	Res,
	UnauthorizedException,
} from '@nestjs/common'
import { ApiOperation, ApiResponse, ApiTags, ApiBearerAuth } from '@nestjs/swagger'
import type { FastifyReply } from 'fastify'
import { TokenService } from '../services/token.service'
import { TokenBlacklistService } from '../services/token-blacklist.service'
import { AUTH_COOKIES, COOKIE_OPTIONS } from '../constants/cookies'

@ApiTags('auth')
@Controller('auth')
export class LogoutController {
	constructor(
		private readonly tokenService: TokenService,
		private readonly tokenBlacklistService: TokenBlacklistService,
	) {}

	@Post('logout')
	@HttpCode(HttpStatus.OK)
	@ApiBearerAuth()
	@ApiOperation({ summary: 'Logout user and invalidate token' })
	@ApiResponse({ status: 200, description: 'Logout successful' })
	@ApiResponse({ status: 401, description: 'Invalid token' })
	async handle(
		@Headers('authorization') authHeader: string,
		@Res({ passthrough: true }) response: FastifyReply,
	) {
		if (!authHeader?.startsWith('Bearer ')) {
			throw new UnauthorizedException('Token not provided')
		}

		const token = authHeader.substring(7)

		try {
			const payload = await this.tokenService.verifyAccessToken(token)
			const expiresIn = payload.exp ? payload.exp - Math.floor(Date.now() / 1000) : 86400

			if (expiresIn > 0) {
				await this.tokenBlacklistService.addToBlacklist(token, expiresIn)
			}

			this.clearAuthCookies(response)

			return { message: 'Logout successful' }
		} catch {
			this.clearAuthCookies(response)
			throw new UnauthorizedException('Invalid token')
		}
	}

	private clearAuthCookies(response: FastifyReply) {
		response.clearCookie(AUTH_COOKIES.ACCESS_TOKEN, {
			...COOKIE_OPTIONS,
		})
		response.clearCookie(AUTH_COOKIES.REFRESH_TOKEN, {
			...COOKIE_OPTIONS,
		})
	}
}
