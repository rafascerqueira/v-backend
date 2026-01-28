import { Test } from '@nestjs/testing'
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard'
import { Reflector } from '@nestjs/core'
import { TokenService } from '@/modules/auth/services/token.service'
import { TokenBlacklistService } from '@/modules/auth/services/token-blacklist.service'
import type { CanActivate } from '@nestjs/common'

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
					generateAccessToken: jest.fn(),
				},
			},
			{
				provide: TokenBlacklistService,
				useValue: {
					isBlacklisted: jest.fn(),
					addToBlacklist: jest.fn(),
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
