import { Injectable, type NestMiddleware } from '@nestjs/common'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { TenantContext } from './tenant.context'

@Injectable()
export class TenantMiddleware implements NestMiddleware {
	constructor(private readonly tenantContext: TenantContext) {}

	use(req: FastifyRequest['raw'], res: FastifyReply['raw'], next: () => void) {
		const user = (req as any).user

		if (user?.sub && user?.role) {
			this.tenantContext.run({ sellerId: user.sub, role: user.role }, () => next())
		} else {
			next()
		}
	}
}
