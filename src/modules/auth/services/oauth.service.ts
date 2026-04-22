import { Injectable, Logger, UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { AccountService } from '@/modules/users/services/account.service'

interface GoogleUserInfo {
	sub: string
	name: string
	email: string
	email_verified: boolean
}

interface FacebookUserInfo {
	id: string
	name: string
	email?: string
}

interface GoogleTokenResponse {
	access_token: string
	token_type: string
	id_token?: string
}

interface FacebookTokenResponse {
	access_token: string
	token_type: string
}

@Injectable()
export class OAuthService {
	private readonly logger = new Logger(OAuthService.name)

	constructor(
		private readonly configService: ConfigService,
		private readonly accountService: AccountService,
	) {}

	getGoogleAuthUrl(): string {
		const clientId = this.configService.get<string>('oauth.google.clientId')
		const callbackUrl = this.configService.get<string>('oauth.google.callbackUrl')

		if (!clientId || !callbackUrl) {
			throw new Error('Google OAuth is not configured')
		}

		const params = new URLSearchParams({
			client_id: clientId,
			redirect_uri: callbackUrl,
			response_type: 'code',
			scope: 'openid email profile',
			access_type: 'online',
		})

		return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
	}

	getFacebookAuthUrl(): string {
		const clientId = this.configService.get<string>('oauth.facebook.clientId')
		const callbackUrl = this.configService.get<string>('oauth.facebook.callbackUrl')

		if (!clientId || !callbackUrl) {
			throw new Error('Facebook OAuth is not configured')
		}

		const params = new URLSearchParams({
			client_id: clientId,
			redirect_uri: callbackUrl,
			response_type: 'code',
			scope: 'email,public_profile',
		})

		return `https://www.facebook.com/v20.0/dialog/oauth?${params.toString()}`
	}

	async handleGoogleCallback(code: string) {
		const clientId = this.configService.get<string>('oauth.google.clientId')
		const clientSecret = this.configService.get<string>('oauth.google.clientSecret')
		const callbackUrl = this.configService.get<string>('oauth.google.callbackUrl')

		if (!clientId || !clientSecret || !callbackUrl) {
			throw new UnauthorizedException('Google OAuth is not configured')
		}

		const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({
				code,
				client_id: clientId,
				client_secret: clientSecret,
				redirect_uri: callbackUrl,
				grant_type: 'authorization_code',
			}),
		})

		if (!tokenRes.ok) {
			this.logger.error(`Google token exchange failed: ${tokenRes.status}`)
			throw new UnauthorizedException('Google authentication failed')
		}

		const tokenData = (await tokenRes.json()) as GoogleTokenResponse

		const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
			headers: { Authorization: `Bearer ${tokenData.access_token}` },
		})

		if (!userRes.ok) {
			this.logger.error(`Google userinfo fetch failed: ${userRes.status}`)
			throw new UnauthorizedException('Failed to retrieve Google user info')
		}

		const userInfo = (await userRes.json()) as GoogleUserInfo

		if (!userInfo.email_verified) {
			throw new UnauthorizedException('Google account email is not verified')
		}

		return this.accountService.findOrCreateOAuthAccount({
			name: userInfo.name,
			email: userInfo.email,
			googleId: userInfo.sub,
		})
	}

	async handleFacebookCallback(code: string) {
		const clientId = this.configService.get<string>('oauth.facebook.clientId')
		const clientSecret = this.configService.get<string>('oauth.facebook.clientSecret')
		const callbackUrl = this.configService.get<string>('oauth.facebook.callbackUrl')

		if (!clientId || !clientSecret || !callbackUrl) {
			throw new UnauthorizedException('Facebook OAuth is not configured')
		}

		const tokenParams = new URLSearchParams({
			client_id: clientId,
			client_secret: clientSecret,
			redirect_uri: callbackUrl,
			code,
		})

		const tokenRes = await fetch(
			`https://graph.facebook.com/v20.0/oauth/access_token?${tokenParams.toString()}`,
		)

		if (!tokenRes.ok) {
			this.logger.error(`Facebook token exchange failed: ${tokenRes.status}`)
			throw new UnauthorizedException('Facebook authentication failed')
		}

		const tokenData = (await tokenRes.json()) as FacebookTokenResponse

		const userParams = new URLSearchParams({
			fields: 'id,name,email',
			access_token: tokenData.access_token,
		})

		const userRes = await fetch(`https://graph.facebook.com/me?${userParams.toString()}`)

		if (!userRes.ok) {
			this.logger.error(`Facebook user info fetch failed: ${userRes.status}`)
			throw new UnauthorizedException('Failed to retrieve Facebook user info')
		}

		const userInfo = (await userRes.json()) as FacebookUserInfo

		if (!userInfo.email) {
			throw new UnauthorizedException('Facebook account does not have a verified email address')
		}

		return this.accountService.findOrCreateOAuthAccount({
			name: userInfo.name,
			email: userInfo.email,
			facebookId: userInfo.id,
		})
	}
}
