import {
	type CanActivate,
	type ExecutionContext,
	ForbiddenException,
	Injectable,
} from '@nestjs/common'
import { PrismaService } from '@/shared/prisma/prisma.service'
import type { AuthenticatedUser } from '../session/session.types'

@Injectable()
export class AdminGuard implements CanActivate {
	constructor(private readonly prisma: PrismaService) {}

	async canActivate(context: ExecutionContext): Promise<boolean> {
		const request = context.switchToHttp().getRequest()
		const user = request.user as AuthenticatedUser | undefined

		if (!user?.sub) {
			throw new ForbiddenException('Authentication required')
		}

		// Verify the role against the database rather than trusting the JWT claim, so a
		// revoked admin loses access immediately instead of staying admin until token expiry.
		const account = await this.prisma.account.findUnique({
			where: { id: user.sub },
			select: { role: true },
		})

		if (account?.role !== 'admin') {
			throw new ForbiddenException('Admin access required')
		}

		return true
	}
}
