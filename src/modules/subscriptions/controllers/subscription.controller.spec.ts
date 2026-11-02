/**
 * SubscriptionController unit tests
 * Covers: GET /subscriptions/info, /plans, /usage, POST /refresh-usage,
 *         GET /check-limit/products|orders|customers
 * Guards mocked: JwtAuthGuard
 */

import { BadRequestException, ConflictException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Test } from '@nestjs/testing'
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard'
import { ZodValidationPipe } from '@/shared/pipes/zod-validation.pipe'
import { checkoutSchema } from '../dto/checkout.dto'
import { CheckoutService } from '../services/checkout.service'
import { PlanLimitsService } from '../services/plan-limits.service'
import { StripeService } from '../services/stripe.service'
import { SubscriptionService } from '../services/subscription.service'
import { SubscriptionController } from './subscription.controller'

const serviceMock = {
	getSubscriptionInfo: jest.fn(),
	getCurrentUsage: jest.fn(),
	refreshUsage: jest.fn(),
	getActiveSubscription: jest.fn(),
	getManageableSubscription: jest.fn(),
	getPortalCustomerId: jest.fn(),
}

const checkoutServiceMock = {
	startCheckout: jest.fn(),
}

const planLimitsServiceMock = {
	canCreateProduct: jest.fn(),
	canCreateOrder: jest.fn(),
	canCreateCustomer: jest.fn(),
}

const stripeServiceMock = {
	createCheckoutSession: jest.fn(),
	createPortalSession: jest.fn(),
}

const configServiceMock = {
	get: jest.fn(),
}

function makeRequest(sub = 'user-uuid-1', plan_type: 'free' | 'pro' | 'enterprise' = 'free') {
	return { user: { sub, plan_type } }
}

describe('SubscriptionController', () => {
	let controller: SubscriptionController

	beforeEach(async () => {
		const module = await Test.createTestingModule({
			controllers: [SubscriptionController],
			providers: [
				{ provide: SubscriptionService, useValue: serviceMock },
				{ provide: PlanLimitsService, useValue: planLimitsServiceMock },
				{ provide: StripeService, useValue: stripeServiceMock },
				{ provide: ConfigService, useValue: configServiceMock },
				{ provide: CheckoutService, useValue: checkoutServiceMock },
			],
		})
			.overrideGuard(JwtAuthGuard)
			.useValue({ canActivate: () => true })
			.compile()

		controller = module.get(SubscriptionController)
		jest.clearAllMocks()
	})

	describe('getSubscriptionInfo', () => {
		it('should return subscription info for the current user', async () => {
			const info = { plan: 'pro', status: 'active' }
			serviceMock.getSubscriptionInfo.mockResolvedValueOnce(info)

			const result = await controller.getSubscriptionInfo(makeRequest())

			expect(serviceMock.getSubscriptionInfo).toHaveBeenCalledWith('user-uuid-1')
			expect(result).toEqual(info)
		})
	})

	describe('getPlans', () => {
		it('should return a plans array with pricing and limits', async () => {
			const result = await controller.getPlans()

			expect(result).toHaveProperty('plans')
			expect(Array.isArray(result.plans)).toBe(true)
			expect(result.plans.length).toBeGreaterThan(0)
			expect(result.plans[0]).toMatchObject({
				id: expect.any(String),
				name: expect.any(String),
				price: expect.anything(),
				limits: expect.objectContaining({
					maxProducts: expect.any(Number),
					maxOrdersPerMonth: expect.any(Number),
					maxCustomers: expect.any(Number),
				}),
				features: expect.any(Object),
			})
		})
	})

	describe('getUsage', () => {
		it('should return current usage for the user', async () => {
			const usage = { products: 10, orders: 5, customers: 20 }
			serviceMock.getCurrentUsage.mockResolvedValueOnce(usage)

			const result = await controller.getUsage(makeRequest())

			expect(serviceMock.getCurrentUsage).toHaveBeenCalledWith('user-uuid-1')
			expect(result).toEqual(usage)
		})
	})

	describe('refreshUsage', () => {
		it('should refresh and return updated usage', async () => {
			const usage = { products: 12, orders: 7, customers: 22 }
			serviceMock.refreshUsage.mockResolvedValueOnce(usage)

			const result = await controller.refreshUsage(makeRequest())

			expect(serviceMock.refreshUsage).toHaveBeenCalledWith('user-uuid-1')
			expect(result).toEqual(usage)
		})
	})

	describe('checkProductsLimit', () => {
		it('should delegate to PlanLimitsService.canCreateProduct and return remaining', async () => {
			planLimitsServiceMock.canCreateProduct.mockResolvedValueOnce({
				allowed: true,
				current: 10,
				limit: 50,
			})

			const result = await controller.checkProductsLimit(makeRequest())

			expect(planLimitsServiceMock.canCreateProduct).toHaveBeenCalledWith('user-uuid-1', 'free')
			expect(result).toEqual({ allowed: true, current: 10, limit: 50, remaining: 40 })
		})

		it('should return remaining: 0 when limit reached', async () => {
			planLimitsServiceMock.canCreateProduct.mockResolvedValueOnce({
				allowed: false,
				current: 50,
				limit: 50,
			})

			const result = await controller.checkProductsLimit(makeRequest())

			expect(result).toEqual({ allowed: false, current: 50, limit: 50, remaining: 0 })
		})

		it('should return remaining: -1 for unlimited plans', async () => {
			planLimitsServiceMock.canCreateProduct.mockResolvedValueOnce({
				allowed: true,
				current: 0,
				limit: -1,
			})

			const result = await controller.checkProductsLimit(makeRequest('user-uuid-1', 'enterprise'))

			expect(planLimitsServiceMock.canCreateProduct).toHaveBeenCalledWith(
				'user-uuid-1',
				'enterprise',
			)
			expect(result).toEqual({ allowed: true, current: 0, limit: -1, remaining: -1 })
		})
	})

	describe('checkOrdersLimit', () => {
		it('should delegate to PlanLimitsService.canCreateOrder', async () => {
			planLimitsServiceMock.canCreateOrder.mockResolvedValueOnce({
				allowed: false,
				current: 30,
				limit: 30,
			})

			const result = await controller.checkOrdersLimit(makeRequest())

			expect(planLimitsServiceMock.canCreateOrder).toHaveBeenCalledWith('user-uuid-1', 'free')
			expect(result).toMatchObject({ allowed: false, remaining: 0 })
		})
	})

	describe('checkCustomersLimit', () => {
		it('should delegate to PlanLimitsService.canCreateCustomer', async () => {
			planLimitsServiceMock.canCreateCustomer.mockResolvedValueOnce({
				allowed: true,
				current: 50,
				limit: 100,
			})

			const result = await controller.checkCustomersLimit(makeRequest())

			expect(planLimitsServiceMock.canCreateCustomer).toHaveBeenCalledWith('user-uuid-1', 'free')
			expect(result).toEqual({ allowed: true, current: 50, limit: 100, remaining: 50 })
		})
	})

	// Orchestration (lock, live Stripe check, 409s) is covered in checkout.service.spec.
	describe('createCheckout', () => {
		it('delegates to CheckoutService with the caller account and validated tier', async () => {
			checkoutServiceMock.startCheckout.mockResolvedValueOnce({ url: 'https://pay' })

			const result = await controller.createCheckout(makeRequest(), { planId: 'enterprise' })

			expect(checkoutServiceMock.startCheckout).toHaveBeenCalledWith('user-uuid-1', 'enterprise')
			expect(result).toEqual({ url: 'https://pay' })
		})

		it('propagates the 409 from CheckoutService unchanged', async () => {
			const conflict = new ConflictException({ message: 'x', code: 'SUBSCRIPTION_EXISTS' })
			checkoutServiceMock.startCheckout.mockRejectedValueOnce(conflict)

			await expect(controller.createCheckout(makeRequest(), { planId: 'pro' })).rejects.toBe(
				conflict,
			)
		})
	})

	// The pipe runs before the handler, so the body schema is exercised directly.
	// planId doubles as a ConfigService path resolved with lodash `get`: '[pro]' or
	// '["pro"]' would still find the Pro price while persisting an invalid plan_type.
	describe('checkout body validation', () => {
		const pipe = new ZodValidationPipe(checkoutSchema)

		it.each(['pro', 'enterprise'])('accepts the paid tier %s', (planId) => {
			expect(pipe.transform({ planId })).toEqual({ planId })
		})

		it.each([
			['[pro]'],
			['["pro"]'],
			['pro.'],
			['free'],
			['__proto__'],
			[''],
			[undefined],
			[['pro']],
		])('rejects planId %p with 400', (planId) => {
			expect(() => pipe.transform({ planId })).toThrow(BadRequestException)
		})

		it('rejects a missing body', () => {
			expect(() => pipe.transform(undefined)).toThrow(BadRequestException)
		})
	})

	describe('createPortal', () => {
		it("opens the portal for the account's Stripe Customer (works before any webhook)", async () => {
			serviceMock.getPortalCustomerId.mockResolvedValueOnce('cus_1')
			configServiceMock.get.mockImplementation((key: string) =>
				key === 'frontendUrl' ? 'https://app.test' : undefined,
			)
			stripeServiceMock.createPortalSession.mockResolvedValueOnce('https://portal')

			const result = await controller.createPortal(makeRequest())

			expect(serviceMock.getPortalCustomerId).toHaveBeenCalledWith('user-uuid-1')
			expect(stripeServiceMock.createPortalSession).toHaveBeenCalledWith(
				'cus_1',
				'https://app.test/plans',
			)
			expect(result).toEqual({ url: 'https://portal' })
		})

		it('should 400 when the account has no Stripe Customer at all', async () => {
			serviceMock.getPortalCustomerId.mockResolvedValueOnce(null)

			await expect(controller.createPortal(makeRequest())).rejects.toThrow(
				'Nenhuma assinatura ativa encontrada',
			)
		})
	})
})
