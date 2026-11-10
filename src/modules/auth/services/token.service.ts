import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import type { SessionTokenClaims } from '../session/session.types'
import { parseDurationSeconds } from '../utils/duration'

type SessionRef = Pick<SessionTokenClaims, 'sub' | 'sid' | 'sv'>

interface VerifyOptions {
	/** Accept a token past its `exp` (logout must work with an expired token). */
	ignoreExpiration?: boolean
}

/**
 * Signs and verifies the two session tokens (RS256). It knows nothing about whether
 * a session is still alive: that is `SessionService`'s job.
 */
@Injectable()
export class TokenService implements OnModuleInit {
	private readonly logger = new Logger(TokenService.name)
	private readonly accessTokenExpiresIn: number
	private readonly keysDir: string
	private privateKey: string = ''
	private publicKey: string = ''

	constructor(
		private readonly jwtService: JwtService,
		readonly configService: ConfigService,
	) {
		this.accessTokenExpiresIn = parseDurationSeconds(
			configService.get<string>('jwt.accessTokenExpiresIn', '1d'),
			86400,
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

	/** Access-token lifetime in seconds. */
	get accessTokenTtl(): number {
		return this.accessTokenExpiresIn
	}

	async signAccessToken(session: SessionRef): Promise<string> {
		return this.jwtService.signAsync(
			{ sub: session.sub, sid: session.sid, sv: session.sv, jti: randomUUID(), type: 'access' },
			{ privateKey: this.privateKey, algorithm: 'RS256', expiresIn: this.accessTokenExpiresIn },
		)
	}

	/** `jti` is the rotation id the session record expects to see next. */
	async signRefreshToken(
		session: SessionRef & { jti: string },
		expiresInSeconds: number,
	): Promise<string> {
		return this.jwtService.signAsync(
			{ sub: session.sub, sid: session.sid, sv: session.sv, jti: session.jti, type: 'refresh' },
			{ privateKey: this.privateKey, algorithm: 'RS256', expiresIn: expiresInSeconds },
		)
	}

	async verifyAccessToken(token: string, options: VerifyOptions = {}): Promise<SessionTokenClaims> {
		return this.verify(token, 'access', options)
	}

	async verifyRefreshToken(
		token: string,
		options: VerifyOptions = {},
	): Promise<SessionTokenClaims> {
		return this.verify(token, 'refresh', options)
	}

	private async verify(
		token: string,
		type: SessionTokenClaims['type'],
		options: VerifyOptions,
	): Promise<SessionTokenClaims> {
		const payload = await this.jwtService.verifyAsync<Partial<SessionTokenClaims>>(token, {
			publicKey: this.publicKey,
			algorithms: ['RS256'],
			ignoreExpiration: options.ignoreExpiration ?? false,
		})
		// Reject a refresh token presented as an access token (and vice versa).
		if (payload.type !== type) {
			throw new Error('Invalid token type')
		}
		// Tokens issued before sessions existed carry no session reference.
		if (
			typeof payload.sub !== 'string' ||
			typeof payload.sid !== 'string' ||
			typeof payload.jti !== 'string' ||
			typeof payload.sv !== 'number'
		) {
			throw new Error('Invalid token claims')
		}
		return payload as SessionTokenClaims
	}
}
