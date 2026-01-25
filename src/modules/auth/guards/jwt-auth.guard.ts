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
		const token = this.extractTokenFromHeader(request)

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

	private extractTokenFromHeader(request: any): string | undefined {
		const [type, token] = request.headers.authorization?.split(' ') ?? []
		return type === 'Bearer' ? token : undefined
	}
}
