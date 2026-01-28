import { Global, Module } from "@nestjs/common";
import { JwtAuthGuard } from "@/modules/auth/guards/jwt-auth.guard";
import { Reflector } from "@nestjs/core";
import { PrismaModule } from "@/shared/prisma/prisma.module";
import { TenantModule } from "@/shared/tenant/tenant.module";

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
			provide: "TokenService",
			useValue: {
				verifyAccessToken: jest.fn(),
				generateAccessToken: jest.fn(),
			},
		},
		{
			provide: "TokenBlacklistService",
			useValue: {
				isBlacklisted: jest.fn(),
				addToBlacklist: jest.fn(),
			},
		},
	],
	exports: [PrismaModule, TenantModule],
})
export class TestBaseModule {}
