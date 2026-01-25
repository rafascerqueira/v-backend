import {
	CanActivate,
	ExecutionContext,
	Injectable,
	UnauthorizedException,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { IS_PUBLIC_KEY } from '../decorators/public.decorator'
import { TokenService } from '../services/token.service'
import { TokenBlacklistService } from '../services/token-blacklist.service'
import { AUTH_COOKIES } from '../constants/cookies'

@Injectable()
export class JwtAuthGuard implements CanActivate {
	constructor(
		private readonly tokenService: TokenService,
		private readonly tokenBlacklistService: TokenBlacklistService,
		private readonly reflector: Reflector,
	) {}

	async canActivate(context: ExecutionContext): Promise<boolean> {
		const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
			context.getHandler(),
			context.getClass(),
		])

		if (isPublic) {
			return true
		}

		const request = context.switchToHttp().getRequest()
		const token = this.extractToken(request)

		if (!token) {
			throw new UnauthorizedException('Token not provided')
		}

		const isBlacklisted = await this.tokenBlacklistService.isBlacklisted(token)
		if (isBlacklisted) {
			throw new UnauthorizedException('Token has been revoked')
		}

		try {
			const payload = await this.tokenService.verifyAccessToken(token)
			request.user = payload
		} catch {
			throw new UnauthorizedException('Invalid or expired token')
		}

		return true
	}

	private extractToken(request: any): string | undefined {
		// First try Authorization header (for backward compatibility and API clients)
		const authHeader = request.headers.authorization
		if (authHeader) {
			const [type, token] = authHeader.split(' ')
			if (type === 'Bearer' && token) {
				return token
			}
		}

		// Then try HttpOnly cookie (more secure for browser clients)
		const cookies = request.cookies
		if (cookies?.[AUTH_COOKIES.ACCESS_TOKEN]) {
			return cookies[AUTH_COOKIES.ACCESS_TOKEN]
		}

		return undefined
	}
}
