import { Controller, Get, Query, Res } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import type { FastifyReply } from 'fastify'
import { AUTH_COOKIES, COOKIE_OPTIONS } from '@/modules/auth/constants/cookies'
import { TokenService } from '@/modules/auth/services/token.service'
import { AccountService } from '@/modules/users/services/account.service'
import { Public } from '../decorators/public.decorator'
import { OAuthService } from '../services/oauth.service'

@ApiTags('auth')
@Controller('auth')
export class OAuthController {
	constructor(
		private readonly oauthService: OAuthService,
		private readonly tokenService: TokenService,
		private readonly accountService: AccountService,
		private readonly configService: ConfigService,
	) {}

	@Get('google')
	@Public()
	@ApiOperation({ summary: 'Redirect to Google OAuth consent screen' })
	async googleLogin(@Res() reply: FastifyReply) {
		const url = this.oauthService.getGoogleAuthUrl()
		return reply.redirect(url, 302)
	}

	@Get('google/callback')
	@Public()
	@ApiOperation({ summary: 'Google OAuth callback' })
	async googleCallback(@Query('code') code: string, @Res() reply: FastifyReply) {
		const frontendUrl = this.configService.get<string>('frontendUrl', 'http://localhost:3000')

		try {
			const account = await this.oauthService.handleGoogleCallback(code)
			await this.accountService.updateLastLogin(account.id)
			const tokens = await this.tokenService.generateTokens({
				sub: account.id,
				email: account.email,
				role: account.role,
			})

			reply.setCookie(AUTH_COOKIES.ACCESS_TOKEN, tokens.accessToken, {
				...COOKIE_OPTIONS,
				maxAge: tokens.expiresIn,
			})
			reply.setCookie(AUTH_COOKIES.REFRESH_TOKEN, tokens.refreshToken, {
				...COOKIE_OPTIONS,
				maxAge: 7 * 24 * 60 * 60,
			})

			return reply.redirect(`${frontendUrl}/dashboard`, 302)
		} catch {
			return reply.redirect(`${frontendUrl}/login?error=oauth_failed`, 302)
		}
	}

	@Get('facebook')
	@Public()
	@ApiOperation({ summary: 'Redirect to Facebook OAuth consent screen' })
	async facebookLogin(@Res() reply: FastifyReply) {
		const url = this.oauthService.getFacebookAuthUrl()
		return reply.redirect(url, 302)
	}

	@Get('facebook/callback')
	@Public()
	@ApiOperation({ summary: 'Facebook OAuth callback' })
	async facebookCallback(@Query('code') code: string, @Res() reply: FastifyReply) {
		const frontendUrl = this.configService.get<string>('frontendUrl', 'http://localhost:3000')

		try {
			const account = await this.oauthService.handleFacebookCallback(code)
			await this.accountService.updateLastLogin(account.id)
			const tokens = await this.tokenService.generateTokens({
				sub: account.id,
				email: account.email,
				role: account.role,
			})

			reply.setCookie(AUTH_COOKIES.ACCESS_TOKEN, tokens.accessToken, {
				...COOKIE_OPTIONS,
				maxAge: tokens.expiresIn,
			})
			reply.setCookie(AUTH_COOKIES.REFRESH_TOKEN, tokens.refreshToken, {
				...COOKIE_OPTIONS,
				maxAge: 7 * 24 * 60 * 60,
			})

			return reply.redirect(`${frontendUrl}/dashboard`, 302)
		} catch {
			return reply.redirect(`${frontendUrl}/login?error=oauth_failed`, 302)
		}
	}
}
