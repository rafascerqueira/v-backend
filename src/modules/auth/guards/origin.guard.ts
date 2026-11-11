import {
	type CanActivate,
	type ExecutionContext,
	ForbiddenException,
	Injectable,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { allowedOriginsFromConfig, isOriginAllowed } from '@/shared/security/allowed-origins'

/**
 * Refuses a request whose `Origin` header names a site the API does not trust.
 *
 * Used on the endpoints that start or renew a session, which cannot rely on the CSRF
 * token (there may be no session yet). Browsers always send `Origin` on a cross-site
 * POST, so a forged request from another site is caught here. A request without the
 * header does not come from a browser page and is let through.
 */
@Injectable()
export class OriginGuard implements CanActivate {
	constructor(private readonly configService: ConfigService) {}

	canActivate(context: ExecutionContext): boolean {
		const request = context.switchToHttp().getRequest()
		const header = request.headers?.origin
		const origin: string | undefined = Array.isArray(header) ? header[0] : header

		if (!origin) return true

		if (!isOriginAllowed(origin, allowedOriginsFromConfig(this.configService))) {
			throw new ForbiddenException({
				statusCode: 403,
				error: 'Forbidden',
				message: 'Origem não permitida',
				code: 'ORIGIN_NOT_ALLOWED',
			})
		}
		return true
	}
}
