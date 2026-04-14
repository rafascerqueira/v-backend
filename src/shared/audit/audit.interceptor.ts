import {
	type CallHandler,
	type ExecutionContext,
	Injectable,
	type NestInterceptor,
} from '@nestjs/common'
import type { FastifyRequest } from 'fastify'
import { type Observable, tap } from 'rxjs'
import type { AuditAction } from './audit.service'
import { AuditService } from './audit.service'

const METHOD_ACTION_MAP: Record<string, AuditAction> = {
	POST: 'CREATE',
	PUT: 'UPDATE',
	PATCH: 'UPDATE',
	DELETE: 'DELETE',
}

const IGNORED_PATHS = ['/auth/login', '/auth/refresh', '/auth/logout', '/health']

@Injectable()
export class AuditInterceptor implements NestInterceptor {
	constructor(private readonly auditService: AuditService) {}

	intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
		const request = context.switchToHttp().getRequest<FastifyRequest>()
		const method = request.method

		if (!METHOD_ACTION_MAP[method]) {
			return next.handle()
		}

		const path = request.url.split('?')[0]

		if (IGNORED_PATHS.some((ignored) => path === ignored)) {
			return next.handle()
		}

		const action = METHOD_ACTION_MAP[method]
		const user = (request as any).user as { sub?: string } | undefined
		const entity = this.extractEntity(path)
		const entityId = this.extractEntityId(path)

		return next.handle().pipe(
			tap({
				next: () => {
					this.auditService.log({
						action,
						entity,
						entityId,
						userId: user?.sub,
						newValue: method !== 'DELETE' ? this.sanitizeBody(request.body) : undefined,
						ipAddress: request.ip,
						userAgent: request.headers['user-agent'],
					})
				},
			}),
		)
	}

	private extractEntity(path: string): string {
		const segments = path.split('/').filter(Boolean)
		// e.g. /products/5/prices/2 → "products/prices"
		return segments.filter((_, i) => i % 2 === 0).join('/') || 'unknown'
	}

	private extractEntityId(path: string): string | undefined {
		const segments = path.split('/').filter(Boolean)
		// Return the last numeric/cuid segment
		for (let i = segments.length - 1; i >= 0; i--) {
			if (/^\d+$/.test(segments[i]) || /^c[a-z0-9]{24}$/i.test(segments[i])) {
				return segments[i]
			}
		}
		return undefined
	}

	private sanitizeBody(body: unknown): Record<string, unknown> | undefined {
		if (!body || typeof body !== 'object') return undefined
		const sanitized = { ...(body as Record<string, unknown>) }
		const sensitiveKeys = ['password', 'salt', 'token', 'secret', 'twoFactorToken', 'code']
		for (const key of sensitiveKeys) {
			if (key in sanitized) {
				sanitized[key] = '[REDACTED]'
			}
		}
		return sanitized
	}
}
