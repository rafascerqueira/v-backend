import {
	type CanActivate,
	type ExecutionContext,
	ForbiddenException,
	Injectable,
} from '@nestjs/common'
import type { Reflector } from '@nestjs/core'
import type { PrismaService } from '@/shared/prisma/prisma.service'
import { ROLES_KEY } from '../decorators/roles.decorator'

@Injectable()
export class RolesGuard implements CanActivate {
	constructor(
		private reflector: Reflector,
		private prisma: PrismaService,
	) {}

	async canActivate(context: ExecutionContext): Promise<boolean> {
		const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
			context.getHandler(),
			context.getClass(),
		])

		if (!requiredRoles) {
			return true
		}

		const request = context.switchToHttp().getRequest()
		const user = request.user

		if (!user?.sub) {
			throw new ForbiddenException('Acesso negado')
		}

		const account = await this.prisma.account.findUnique({
			where: { id: user.sub },
			select: { role: true },
		})

		if (!account || !requiredRoles.includes(account.role)) {
			throw new ForbiddenException('Acesso restrito a administradores')
		}

		return true
	}
}
