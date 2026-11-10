import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { AUTH_COOKIES } from '../constants/cookies'
import { IS_PUBLIC_KEY } from '../decorators/public.decorator'
import { SessionService } from '../services/session.service'
import { SESSION_ERROR_CODE, SessionException } from '../session/session.errors'

@Injectable()
export class JwtAuthGuard implements CanActivate {
	constructor(
		private readonly sessionService: SessionService,
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
			throw new SessionException(SESSION_ERROR_CODE.EXPIRED)
		}

		// `request.user` is the account as it is now (role, plan, e-mail read from the
		// account, not from the token), so plan guards and tenant scoping downstream
		// always act on current data.
		request.user = await this.sessionService.authenticate(token)

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
