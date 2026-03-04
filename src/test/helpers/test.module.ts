import type { CanActivate } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard'

export const createTestingModule = (controller: any, providers: any[] = []) => {
	return Test.createTestingModule({
		controllers: [controller],
		providers: [
			{ provide: Reflector, useValue: {} },
			{
				provide: 'TokenService',
				useValue: {},
			},
			{
				provide: 'TokenBlacklistService',
				useValue: {},
			},
			...providers,
		],
	})
		.overrideGuard(JwtAuthGuard)
		.useValue({
			canActivate: () => true,
		} as CanActivate)
}
