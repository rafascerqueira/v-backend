import type { CanActivate } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard'
import { SessionService } from '@/modules/auth/services/session.service'
import { TokenService } from '@/modules/auth/services/token.service'

export const createTestModule = async (controller: any, providers: any[] = []) => {
	const testModule = Test.createTestingModule({
		controllers: [controller],
		providers: [
			{
				provide: Reflector,
				useValue: {
					getAllAndOverride: jest.fn(),
					get: jest.fn(),
				},
			},
			{
				provide: TokenService,
				useValue: {
					verifyAccessToken: jest.fn(),
					signAccessToken: jest.fn(),
				},
			},
			{
				provide: SessionService,
				useValue: {
					authenticate: jest.fn(),
				},
			},
			...providers,
		],
	})

	// Mock the JwtAuthGuard to always return true
	testModule.overrideGuard(JwtAuthGuard).useValue({
		canActivate: jest.fn(() => true),
	} as CanActivate)

	return testModule.compile()
}
