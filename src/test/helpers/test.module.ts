import { Test } from "@nestjs/testing";
import { JwtAuthGuard } from "@/modules/auth/guards/jwt-auth.guard";
import { Reflector } from "@nestjs/core";
import type { CanActivate } from "@nestjs/common";

export const createTestingModule = (controller: any, providers: any[] = []) => {
	return Test.createTestingModule({
		controllers: [controller],
		providers: [
			{ provide: Reflector, useValue: {} },
			{
				provide: "TokenService",
				useValue: {},
			},
			{
				provide: "TokenBlacklistService",
				useValue: {},
			},
			...providers,
		],
	})
		.overrideGuard(JwtAuthGuard)
		.useValue({
			canActivate: () => true,
		} as CanActivate);
};
