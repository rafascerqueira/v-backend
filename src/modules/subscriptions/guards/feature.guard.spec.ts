import type { ExecutionContext } from '@nestjs/common'
import { ForbiddenException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { FeatureGuard } from './feature.guard'

// Builds an ExecutionContext whose request carries the given user.
function contextWithUser(user: unknown): ExecutionContext {
	return {
		switchToHttp: () => ({ getRequest: () => ({ user }) }),
		getHandler: () => ({}),
		getClass: () => ({}),
	} as unknown as ExecutionContext
}

describe('FeatureGuard', () => {
	let guard: FeatureGuard
	let reflector: { getAllAndOverride: jest.Mock }
	let planLimitsService: { hasFeature: jest.Mock }

	beforeEach(() => {
		reflector = { getAllAndOverride: jest.fn() }
		planLimitsService = { hasFeature: jest.fn() }
		guard = new FeatureGuard(reflector as unknown as Reflector, planLimitsService as never)
	})

	it('allows the route when no @RequiredFeature metadata is present', async () => {
		reflector.getAllAndOverride.mockReturnValue(undefined)
		expect(await guard.canActivate(contextWithUser({ sub: 's', plan_type: 'free' }))).toBe(true)
		expect(planLimitsService.hasFeature).not.toHaveBeenCalled()
	})

	it('lets admins bypass the feature gate', async () => {
		reflector.getAllAndOverride.mockReturnValue('reports')
		const ok = await guard.canActivate(contextWithUser({ sub: 's', role: 'admin' }))
		expect(ok).toBe(true)
		expect(planLimitsService.hasFeature).not.toHaveBeenCalled()
	})

	it('allows when the seller has the feature', async () => {
		reflector.getAllAndOverride.mockReturnValue('reports')
		planLimitsService.hasFeature.mockResolvedValue(true)
		expect(await guard.canActivate(contextWithUser({ sub: 's', plan_type: 'pro' }))).toBe(true)
		expect(planLimitsService.hasFeature).toHaveBeenCalledWith('s', 'pro', 'reports')
	})

	it('throws 403 when the seller lacks the feature', async () => {
		reflector.getAllAndOverride.mockReturnValue('reports')
		planLimitsService.hasFeature.mockResolvedValue(false)
		await expect(
			guard.canActivate(contextWithUser({ sub: 's', plan_type: 'free' })),
		).rejects.toThrow(ForbiddenException)
	})

	it('defaults a missing plan_type to free', async () => {
		reflector.getAllAndOverride.mockReturnValue('exportData')
		planLimitsService.hasFeature.mockResolvedValue(false)
		await expect(guard.canActivate(contextWithUser({ sub: 's' }))).rejects.toThrow(
			ForbiddenException,
		)
		expect(planLimitsService.hasFeature).toHaveBeenCalledWith('s', 'free', 'exportData')
	})
})
