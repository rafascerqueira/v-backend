import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import type { AuthResponseDto, TokenPayload } from '../dto/auth-response.dto'

@Injectable()
export class TokenService implements OnModuleInit {
	private readonly logger = new Logger(TokenService.name)
	private readonly accessTokenExpiresIn: number
	private readonly refreshTokenExpiresIn: number
	private readonly keysDir: string
	private privateKey: string = ''
	private publicKey: string = ''

	constructor(
		private readonly jwtService: JwtService,
		readonly configService: ConfigService,
	) {
		this.accessTokenExpiresIn = this.parseExpiresIn(
			configService.get<string>('jwt.accessTokenExpiresIn', '1d'),
		)
		this.refreshTokenExpiresIn = this.parseExpiresIn(
			configService.get<string>('jwt.refreshTokenExpiresIn', '7d'),
		)
		this.keysDir = configService.get<string>('jwt.keysDir') || join(process.cwd(), 'keys')
	}

	onModuleInit() {
		const keysDir = this.keysDir
		const privateKeyPath = join(keysDir, 'private.pem')
		const publicKeyPath = join(keysDir, 'public.pem')

		if (!existsSync(privateKeyPath) || !existsSync(publicKeyPath)) {
			throw new Error(
				`RS256 JWT keys not found at ${keysDir}. Both private.pem and public.pem are required.`,
			)
		}

		this.privateKey = readFileSync(privateKeyPath, 'utf8')
		this.publicKey = readFileSync(publicKeyPath, 'utf8')
		this.logger.log('JWT: Using RS256 (asymmetric keys)')
	}

	private parseExpiresIn(value: string): number {
		const match = value.match(/^(\d+)([smhd])$/)
		if (!match) return 86400

		const num = parseInt(match[1], 10)
		const unit = match[2]

		switch (unit) {
			case 's':
				return num
			case 'm':
				return num * 60
			case 'h':
				return num * 3600
			case 'd':
				return num * 86400
			default:
				return 86400
		}
	}

	async generateTokens(payload: TokenPayload): Promise<AuthResponseDto> {
		const signOptions = { privateKey: this.privateKey, algorithm: 'RS256' as const }
		const refreshSignOptions = { privateKey: this.privateKey, algorithm: 'RS256' as const }

		const [accessToken, refreshToken] = await Promise.all([
			this.jwtService.signAsync(
				{
					sub: payload.sub,
					email: payload.email,
					role: payload.role,
					type: 'access',
				},
				{ ...signOptions, expiresIn: this.accessTokenExpiresIn },
			),
			this.jwtService.signAsync(
				{
					sub: payload.sub,
					email: payload.email,
					role: payload.role,
					type: 'refresh',
				},
				{ ...refreshSignOptions, expiresIn: this.refreshTokenExpiresIn },
			),
		])

		return {
			accessToken,
			refreshToken,
			expiresIn: this.accessTokenExpiresIn,
		}
	}

	async verifyAccessToken(token: string): Promise<TokenPayload> {
		return this.jwtService.verifyAsync<TokenPayload>(token, {
			publicKey: this.publicKey,
			algorithms: ['RS256' as const],
		})
	}

	async verifyRefreshToken(token: string): Promise<TokenPayload> {
		return this.jwtService.verifyAsync<TokenPayload>(token, {
			publicKey: this.publicKey,
			algorithms: ['RS256' as const],
		})
	}

	async refreshTokens(
		refreshToken: string,
		blacklistService?: TokenBlacklistService,
	): Promise<AuthResponseDto> {
		const payload = await this.verifyRefreshToken(refreshToken)

		// Blacklist the old refresh token to prevent reuse
		if (blacklistService) {
			const expiresIn = payload.exp
				? payload.exp - Math.floor(Date.now() / 1000)
				: this.refreshTokenExpiresIn
			if (expiresIn > 0) {
				await blacklistService.addToBlacklist(refreshToken, expiresIn)
			}
		}

		return this.generateTokens({
			sub: payload.sub,
			email: payload.email,
			role: payload.role,
		})
	}
}

// Import at bottom to avoid circular dependency
import { TokenBlacklistService } from './token-blacklist.service'
