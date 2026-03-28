import { Controller, Headers, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { AUTH_COOKIES, COOKIE_OPTIONS } from '../constants/cookies'
import { TokenService } from '../services/token.service'
import { TokenBlacklistService } from '../services/token-blacklist.service'

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
	async handle(
		@Headers('authorization') authHeader: string,
		@Req() request: FastifyRequest,
		@Res({ passthrough: true }) response: FastifyReply,
	) {
		const accessToken = this.extractAccessToken(authHeader, request)
		const refreshToken = this.extractRefreshToken(request)

		if (accessToken) {
			try {
				const payload = await this.tokenService.verifyAccessToken(accessToken)
				const expiresIn = payload.exp ? payload.exp - Math.floor(Date.now() / 1000) : 86400

				if (expiresIn > 0) {
					await this.tokenBlacklistService.addToBlacklist(accessToken, expiresIn)
				}
			} catch {
				// Token invalid or expired, just clear cookies
			}
		}

		if (refreshToken) {
			try {
				const payload = await this.tokenService.verifyRefreshToken(refreshToken)
				const expiresIn = payload.exp ? payload.exp - Math.floor(Date.now() / 1000) : 7 * 86400

				if (expiresIn > 0) {
					await this.tokenBlacklistService.addToBlacklist(refreshToken, expiresIn)
				}
			} catch {
				// Token invalid or expired, just clear cookies
			}
		}

		this.clearAuthCookies(response)
		return { message: 'Logout successful' }
	}

	private extractAccessToken(authHeader: string, request: FastifyRequest): string | null {
		if (authHeader?.startsWith('Bearer ')) {
			return authHeader.substring(7)
		}

		const cookies = request.cookies
		if (cookies?.[AUTH_COOKIES.ACCESS_TOKEN]) {
			return cookies[AUTH_COOKIES.ACCESS_TOKEN] ?? null
		}

		return null
	}

	private extractRefreshToken(request: FastifyRequest): string | null {
		const cookies = request.cookies
		if (cookies?.[AUTH_COOKIES.REFRESH_TOKEN]) {
			return cookies[AUTH_COOKIES.REFRESH_TOKEN] ?? null
		}

		return null
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
