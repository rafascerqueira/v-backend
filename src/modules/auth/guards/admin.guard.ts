import {
	CanActivate,
	ExecutionContext,
	ForbiddenException,
	Injectable,
} from '@nestjs/common'
import type { FastifyRequest } from 'fastify'
import type { TokenPayload } from '../dto/auth-response.dto'

@Injectable()
export class AdminGuard implements CanActivate {
	canActivate(context: ExecutionContext): boolean {
		const request = context.switchToHttp().getRequest<FastifyRequest>()
		const user = request['user'] as TokenPayload | undefined

		if (!user) {
			throw new ForbiddenException('Authentication required')
		}

		if (user.role !== 'admin') {
			throw new ForbiddenException('Admin access required')
		}

		return true
	}
}
