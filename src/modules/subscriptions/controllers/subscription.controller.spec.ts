/**
 * SubscriptionController unit tests
 * Covers: GET /subscriptions/info, /plans, /usage, POST /refresh-usage,
 *         GET /check-limit/products|orders|customers
 * Guards mocked: JwtAuthGuard
 */

import { ConfigService } from '@nestjs/config'
import { Test } from '@nestjs/testing'
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard'
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

	describe('createCheckout', () => {
		it('should resolve the price id and forward the planId as the tier', async () => {
			configServiceMock.get.mockImplementation((key: string) => {
				if (key === 'stripe.priceIds.pro') return 'price_pro'
				if (key === 'frontendUrl') return 'https://app.test'
				return undefined
			})
			stripeServiceMock.createCheckoutSession.mockResolvedValueOnce({ url: 'https://pay' })

			const result = await controller.createCheckout(makeRequest(), { planId: 'pro' })

			expect(stripeServiceMock.createCheckoutSession).toHaveBeenCalledWith(
				'user-uuid-1',
				'price_pro',
				'https://app.test/plans?checkout=success',
				'https://app.test/plans?checkout=canceled',
				'pro',
			)
			expect(result).toEqual({ url: 'https://pay' })
		})

		it('should 400 when the plan/price is not configured', async () => {
			configServiceMock.get.mockReturnValue(undefined)

			await expect(controller.createCheckout(makeRequest(), { planId: 'bogus' })).rejects.toThrow(
				'Plano inválido ou pagamento não configurado',
			)
		})
	})

	describe('createPortal', () => {
		it('should open the portal for a past_due subscription (dunning recovery)', async () => {
			serviceMock.getManageableSubscription.mockResolvedValueOnce({
				status: 'past_due',
				provider_customer_id: 'cus_1',
			})
			configServiceMock.get.mockImplementation((key: string) =>
				key === 'frontendUrl' ? 'https://app.test' : undefined,
			)
			stripeServiceMock.createPortalSession.mockResolvedValueOnce('https://portal')

			const result = await controller.createPortal(makeRequest())

			expect(serviceMock.getManageableSubscription).toHaveBeenCalledWith('user-uuid-1')
			expect(stripeServiceMock.createPortalSession).toHaveBeenCalledWith(
				'cus_1',
				'https://app.test/plans',
			)
			expect(result).toEqual({ url: 'https://portal' })
		})

		it('should 400 when there is no manageable subscription', async () => {
			serviceMock.getManageableSubscription.mockResolvedValueOnce(null)

			await expect(controller.createPortal(makeRequest())).rejects.toThrow(
				'Nenhuma assinatura ativa encontrada',
			)
		})
	})
})
