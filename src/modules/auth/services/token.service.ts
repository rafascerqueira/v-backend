import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Injectable, type OnModuleInit } from '@nestjs/common'
import type { JwtService } from '@nestjs/jwt'
import type { AuthResponseDto, TokenPayload } from '../dto/auth-response.dto'

@Injectable()
export class TokenService implements OnModuleInit {
	private readonly accessTokenExpiresIn: number
	private readonly refreshTokenExpiresIn: number
	private privateKey: string = ''
	private publicKey: string = ''
	private useAsymmetric: boolean = false

	constructor(private readonly jwtService: JwtService) {
		this.accessTokenExpiresIn = this.parseExpiresIn(process.env.JWT_ACCESS_TOKEN_EXPIRES_IN || '1d')
		this.refreshTokenExpiresIn = this.parseExpiresIn(
			process.env.JWT_REFRESH_TOKEN_EXPIRES_IN || '7d',
		)
	}

	onModuleInit() {
		const keysDir = process.env.JWT_KEYS_DIR || join(process.cwd(), 'keys')
		const privateKeyPath = join(keysDir, 'private.pem')
		const publicKeyPath = join(keysDir, 'public.pem')

		if (existsSync(privateKeyPath) && existsSync(publicKeyPath)) {
			this.privateKey = readFileSync(privateKeyPath, 'utf8')
			this.publicKey = readFileSync(publicKeyPath, 'utf8')
			this.useAsymmetric = true
			console.log('🔐 JWT: Using RS256 (asymmetric keys)')
		} else {
			console.log('🔑 JWT: Using HS256 (symmetric secret) - keys not found')
		}
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
		const signOptions = this.useAsymmetric
			? { privateKey: this.privateKey, algorithm: 'RS256' as const }
			: { secret: process.env.JWT_SECRET }

		const refreshSignOptions = this.useAsymmetric
			? { privateKey: this.privateKey, algorithm: 'RS256' as const }
			: { secret: process.env.JWT_REFRESH_SECRET }

		const [accessToken, refreshToken] = await Promise.all([
			this.jwtService.signAsync(
				{ sub: payload.sub, email: payload.email, role: payload.role, type: 'access' },
				{ ...signOptions, expiresIn: this.accessTokenExpiresIn },
			),
			this.jwtService.signAsync(
				{ sub: payload.sub, email: payload.email, role: payload.role, type: 'refresh' },
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
		const verifyOptions = this.useAsymmetric
			? { publicKey: this.publicKey, algorithms: ['RS256' as const] }
			: { secret: process.env.JWT_SECRET }

		return this.jwtService.verifyAsync<TokenPayload>(token, verifyOptions)
	}

	async verifyRefreshToken(token: string): Promise<TokenPayload> {
		const verifyOptions = this.useAsymmetric
			? { publicKey: this.publicKey, algorithms: ['RS256' as const] }
			: { secret: process.env.JWT_REFRESH_SECRET }

		return this.jwtService.verifyAsync<TokenPayload>(token, verifyOptions)
	}

	async refreshTokens(refreshToken: string): Promise<AuthResponseDto> {
		const payload = await this.verifyRefreshToken(refreshToken)
		return this.generateTokens({
			sub: payload.sub,
			email: payload.email,
			role: payload.role,
		})
	}
}
