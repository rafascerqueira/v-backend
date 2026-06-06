import { Controller, Get, Query, Req, Res } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import type { FastifyReply, FastifyRequest } from 'fastify'
import {
	AUTH_COOKIES,
	COOKIE_OPTIONS,
	OAUTH_STATE_COOKIE_OPTIONS,
} from '@/modules/auth/constants/cookies'
import { TokenService } from '@/modules/auth/services/token.service'
import { AccountService } from '@/modules/users/services/account.service'
import { Public } from '../decorators/public.decorator'
import { OAuthService } from '../services/oauth.service'
import { setCsrfCookie } from '../utils/csrf'

@ApiTags('auth')
@Controller('auth')
export class OAuthController {
	constructor(
		private readonly oauthService: OAuthService,
		private readonly tokenService: TokenService,
		private readonly accountService: AccountService,
		private readonly configService: ConfigService,
	) {}

	private setAuthCookies(
		reply: FastifyReply,
		accessToken: string,
		refreshToken: string,
		accessMaxAge: number,
	) {
		reply.setCookie(AUTH_COOKIES.ACCESS_TOKEN, accessToken, {
			...COOKIE_OPTIONS,
			maxAge: accessMaxAge,
		})
		reply.setCookie(AUTH_COOKIES.REFRESH_TOKEN, refreshToken, {
			...COOKIE_OPTIONS,
			maxAge: 7 * 24 * 60 * 60,
		})
		setCsrfCookie(reply, accessMaxAge)
	}

	private writeStateCookie(reply: FastifyReply, state: string) {
		reply.setCookie(AUTH_COOKIES.OAUTH_STATE, state, OAUTH_STATE_COOKIE_OPTIONS)
	}

	private clearStateCookie(reply: FastifyReply) {
		reply.clearCookie(AUTH_COOKIES.OAUTH_STATE, {
			path: OAUTH_STATE_COOKIE_OPTIONS.path,
			...(OAUTH_STATE_COOKIE_OPTIONS.domain ? { domain: OAUTH_STATE_COOKIE_OPTIONS.domain } : {}),
		})
	}

	@Get('google')
	@Public()
	@ApiOperation({ summary: 'Redirect to Google OAuth consent screen' })
	async googleLogin(@Res() reply: FastifyReply) {
		const state = this.oauthService.generateState()
		this.writeStateCookie(reply, state)
		const url = this.oauthService.getGoogleAuthUrl(state)
		return reply.redirect(url, 302)
	}

	@Get('google/callback')
	@Public()
	@ApiOperation({ summary: 'Google OAuth callback' })
	async googleCallback(
		@Query('code') code: string,
		@Query('state') state: string,
		@Req() request: FastifyRequest,
		@Res() reply: FastifyReply,
	) {
		const frontendUrl = this.configService.get<string>('frontendUrl', 'http://localhost:3000')
		const expectedState = request.cookies?.[AUTH_COOKIES.OAUTH_STATE]
		this.clearStateCookie(reply)

		if (!this.oauthService.verifyState(expectedState, state)) {
			return reply.redirect(`${frontendUrl}/login?error=oauth_state`, 302)
		}

		try {
			const account = await this.oauthService.handleGoogleCallback(code)
			await this.accountService.updateLastLogin(account.id)
			const tokens = await this.tokenService.generateTokens({
				sub: account.id,
				email: account.email,
				role: account.role,
				plan_type: account.plan_type,
			})

			this.setAuthCookies(reply, tokens.accessToken, tokens.refreshToken, tokens.expiresIn)

			return reply.redirect(`${frontendUrl}/dashboard`, 302)
		} catch {
			return reply.redirect(`${frontendUrl}/login?error=oauth_failed`, 302)
		}
	}

	@Get('facebook')
	@Public()
	@ApiOperation({ summary: 'Redirect to Facebook OAuth consent screen' })
	async facebookLogin(@Res() reply: FastifyReply) {
		const state = this.oauthService.generateState()
		this.writeStateCookie(reply, state)
		const url = this.oauthService.getFacebookAuthUrl(state)
		return reply.redirect(url, 302)
	}

	@Get('facebook/callback')
	@Public()
	@ApiOperation({ summary: 'Facebook OAuth callback' })
	async facebookCallback(
		@Query('code') code: string,
		@Query('state') state: string,
		@Req() request: FastifyRequest,
		@Res() reply: FastifyReply,
	) {
		const frontendUrl = this.configService.get<string>('frontendUrl', 'http://localhost:3000')
		const expectedState = request.cookies?.[AUTH_COOKIES.OAUTH_STATE]
		this.clearStateCookie(reply)

		if (!this.oauthService.verifyState(expectedState, state)) {
			return reply.redirect(`${frontendUrl}/login?error=oauth_state`, 302)
		}

		try {
			const account = await this.oauthService.handleFacebookCallback(code)
			await this.accountService.updateLastLogin(account.id)
			const tokens = await this.tokenService.generateTokens({
				sub: account.id,
				email: account.email,
				role: account.role,
				plan_type: account.plan_type,
			})

			this.setAuthCookies(reply, tokens.accessToken, tokens.refreshToken, tokens.expiresIn)

			return reply.redirect(`${frontendUrl}/dashboard`, 302)
		} catch {
			return reply.redirect(`${frontendUrl}/login?error=oauth_failed`, 302)
		}
	}
}
