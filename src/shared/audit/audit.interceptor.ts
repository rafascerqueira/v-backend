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

	private isIdSegment(segment: string): boolean {
		return (
			/^\d+$/.test(segment) || // numeric id
			/^c[a-z0-9]{24}$/i.test(segment) || // cuid
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment) // uuid
		)
	}

	private extractEntity(path: string): string {
		// Drop id-like segments so the entity reflects the resource, not a record:
		// /products/5/prices/2 → "products/prices"
		// /admin/accounts/cmq.../suspend → "admin/accounts/suspend"
		// (The previous even-index heuristic embedded record ids into the entity,
		// polluting the admin logs entity filter with one value per record.)
		const segments = path.split('/').filter(Boolean)
		return segments.filter((segment) => !this.isIdSegment(segment)).join('/') || 'unknown'
	}

	private extractEntityId(path: string): string | undefined {
		const segments = path.split('/').filter(Boolean)
		// Return the last id-like segment
		for (let i = segments.length - 1; i >= 0; i--) {
			if (this.isIdSegment(segments[i])) {
				return segments[i]
			}
		}
		return undefined
	}

	// Match by substring (case-insensitive) so variants like currentPassword,
	// newPassword, refreshToken, twoFactorToken etc. are all caught — the old
	// exact-match list let plaintext passwords through into audit_logs.
	private static readonly SENSITIVE_KEY_PATTERN =
		/password|senha|secret|token|salt|csrf|authorization|otp|^code$/i

	private sanitizeBody(body: unknown, depth = 0): Record<string, unknown> | undefined {
		if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined
		if (depth > 3) return undefined

		const sanitized: Record<string, unknown> = {}
		for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
			if (AuditInterceptor.SENSITIVE_KEY_PATTERN.test(key)) {
				sanitized[key] = '[REDACTED]'
			} else if (value && typeof value === 'object' && !Array.isArray(value)) {
				sanitized[key] = this.sanitizeBody(value, depth + 1)
			} else {
				sanitized[key] = value
			}
		}
		return sanitized
	}
}
