import { Global, Module } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard'
import { PrismaModule } from '@/shared/prisma/prisma.module'
import { TenantModule } from '@/shared/tenant/tenant.module'

@Global()
@Module({
	imports: [PrismaModule, TenantModule],
	providers: [
		{
			provide: Reflector,
			useValue: {
				getAllAndOverride: jest.fn(),
				get: jest.fn(),
			},
		},
		{
			provide: 'TokenService',
			useValue: {
				verifyAccessToken: jest.fn(),
				signAccessToken: jest.fn(),
			},
		},
		{
			provide: 'SessionService',
			useValue: {
				authenticate: jest.fn(),
			},
		},
	],
	exports: [PrismaModule, TenantModule],
})
export class TestBaseModule {}
