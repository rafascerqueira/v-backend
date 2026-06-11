/**
 * PlanLimitsGuard unit tests.
 * Covers: no-metadata pass-through, no-user pass-through, admin bypass,
 *         per-resource-type dispatch (product/customer/order), limit-reached
 *         -> ForbiddenException with the service-provided message, and the
 *         allowed path (which is where an unlimited/-1 limit resolves to
 *         allowed:true inside the service).
 *
 * PlanLimitsService is mocked at the constructor level (no real repository/DB).
 */
import { ForbiddenException } from '@nestjs/common'
import type { Reflector } from '@nestjs/core'
import type { LimitCheckResult, PlanLimitsService } from '../services/plan-limits.service'
import { PlanLimitsGuard } from './plan-limits.guard'

function makeContext(req: any): any {
	return {
		switchToHttp: () => ({ getRequest: () => req }),
		getHandler: () => null,
		getClass: () => null,
	}
}

const allowed = (over: Partial<LimitCheckResult> = {}): LimitCheckResult => ({
	allowed: true,
	current: 1,
	limit: 10,
	...over,
})

const denied = (message: string): LimitCheckResult => ({
	allowed: false,
	message,
	current: 10,
	limit: 10,
})

describe('PlanLimitsGuard', () => {
	let guard: PlanLimitsGuard
	let reflector: { getAllAndOverride: jest.Mock }
	let service: {
		canCreateProduct: jest.Mock
		canCreateCustomer: jest.Mock
		canCreateOrder: jest.Mock
	}

	beforeEach(() => {
		reflector = { getAllAndOverride: jest.fn() }
		service = {
			canCreateProduct: jest.fn(),
			canCreateCustomer: jest.fn(),
			canCreateOrder: jest.fn(),
		}
		guard = new PlanLimitsGuard(
			reflector as unknown as Reflector,
			service as unknown as PlanLimitsService,
		)
	})

	it('passes through when no @CheckPlanLimit() metadata is present', async () => {
		reflector.getAllAndOverride.mockReturnValue(undefined)
		const req = { user: { sub: 'seller-1', plan_type: 'free' } }

		await expect(guard.canActivate(makeContext(req))).resolves.toBe(true)
		expect(service.canCreateProduct).not.toHaveBeenCalled()
	})

	it('passes through when the request has no user (no quota to attribute)', async () => {
		reflector.getAllAndOverride.mockReturnValue('product')
		const req = { user: undefined }

		await expect(guard.canActivate(makeContext(req))).resolves.toBe(true)
		expect(service.canCreateProduct).not.toHaveBeenCalled()
	})

	it('lets admins bypass plan limits entirely', async () => {
		reflector.getAllAndOverride.mockReturnValue('product')
		const req = { user: { sub: 'admin-1', role: 'admin', plan_type: 'free' } }

		await expect(guard.canActivate(makeContext(req))).resolves.toBe(true)
		expect(service.canCreateProduct).not.toHaveBeenCalled()
	})

	it('checks the product limit and passes the sellerId + plan_type through', async () => {
		reflector.getAllAndOverride.mockReturnValue('product')
		service.canCreateProduct.mockResolvedValue(allowed())
		const req = { user: { sub: 'seller-1', plan_type: 'pro' } }

		await expect(guard.canActivate(makeContext(req))).resolves.toBe(true)
		expect(service.canCreateProduct).toHaveBeenCalledWith('seller-1', 'pro')
	})

	it('checks the customer limit for the customer resource type', async () => {
		reflector.getAllAndOverride.mockReturnValue('customer')
		service.canCreateCustomer.mockResolvedValue(allowed())
		const req = { user: { sub: 'seller-2', plan_type: 'free' } }

		await expect(guard.canActivate(makeContext(req))).resolves.toBe(true)
		expect(service.canCreateCustomer).toHaveBeenCalledWith('seller-2', 'free')
		expect(service.canCreateProduct).not.toHaveBeenCalled()
	})

	it('checks the order limit for the order resource type', async () => {
		reflector.getAllAndOverride.mockReturnValue('order')
		service.canCreateOrder.mockResolvedValue(allowed())
		const req = { user: { sub: 'seller-3', plan_type: 'enterprise' } }

		await expect(guard.canActivate(makeContext(req))).resolves.toBe(true)
		expect(service.canCreateOrder).toHaveBeenCalledWith('seller-3', 'enterprise')
	})

	it("defaults plan_type to 'free' when the user has none", async () => {
		reflector.getAllAndOverride.mockReturnValue('product')
		service.canCreateProduct.mockResolvedValue(allowed())
		const req = { user: { sub: 'seller-4' } }

		await expect(guard.canActivate(makeContext(req))).resolves.toBe(true)
		expect(service.canCreateProduct).toHaveBeenCalledWith('seller-4', 'free')
	})

	it('throws ForbiddenException with the service message when the limit is reached', async () => {
		reflector.getAllAndOverride.mockReturnValue('product')
		service.canCreateProduct.mockResolvedValue(
			denied('Limite de produtos atingido (5). Faça upgrade para o plano Pro.'),
		)
		const req = { user: { sub: 'seller-5', plan_type: 'free' } }

		await expect(guard.canActivate(makeContext(req))).rejects.toThrow(
			new ForbiddenException('Limite de produtos atingido (5). Faça upgrade para o plano Pro.'),
		)
	})

	it('allows when the service reports an unlimited (-1) limit as allowed', async () => {
		// Unlimited is resolved inside the service to { allowed: true, limit: -1 };
		// the guard only acts on the allowed flag.
		reflector.getAllAndOverride.mockReturnValue('order')
		service.canCreateOrder.mockResolvedValue(
			allowed({ current: 9999, limit: -1, unlimitedReason: 'unlimited_period' }),
		)
		const req = { user: { sub: 'seller-6', plan_type: 'free' } }

		await expect(guard.canActivate(makeContext(req))).resolves.toBe(true)
	})
})
