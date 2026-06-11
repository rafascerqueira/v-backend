/**
 * WebhookController unit tests
 * Covers: POST /webhooks/stripe, POST /webhooks/pagseguro
 * Both routes are @Public — no auth guard required
 */

import { BadRequestException, GoneException, InternalServerErrorException } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard'
import { StripeService } from '../services/stripe.service'
import { WebhookService } from '../services/webhook.service'
import { WebhookController } from './webhook.controller'

const webhookServiceMock = {
	processStripeWebhook: jest.fn(),
	processPagSeguroWebhook: jest.fn(),
}

const stripeServiceMock = {
	constructWebhookEvent: jest.fn(),
}

describe('WebhookController', () => {
	let controller: WebhookController

	beforeEach(async () => {
		const module = await Test.createTestingModule({
			controllers: [WebhookController],
			providers: [
				{ provide: WebhookService, useValue: webhookServiceMock },
				{ provide: StripeService, useValue: stripeServiceMock },
			],
		})
			.overrideGuard(JwtAuthGuard)
			.useValue({ canActivate: () => true })
			.compile()

		controller = module.get(WebhookController)
		jest.clearAllMocks()
	})

	describe('handleStripeWebhook', () => {
		const rawBody = Buffer.from('{}')
		const stripeEvent = { id: 'evt_1', type: 'checkout.session.completed', data: {} }

		it('should verify rawBody, process event and return received: true', async () => {
			stripeServiceMock.constructWebhookEvent.mockReturnValueOnce(stripeEvent)
			webhookServiceMock.processStripeWebhook.mockResolvedValueOnce(undefined)

			const req = { rawBody }
			const result = await controller.handleStripeWebhook(req as any, 'stripe-sig')

			expect(stripeServiceMock.constructWebhookEvent).toHaveBeenCalledWith(rawBody, 'stripe-sig')
			expect(webhookServiceMock.processStripeWebhook).toHaveBeenCalledWith(stripeEvent)
			expect(result).toEqual({ received: true })
		})

		it('should throw BadRequestException when stripe signature is missing', async () => {
			const req = { rawBody }
			await expect(controller.handleStripeWebhook(req as any, '')).rejects.toThrow(
				BadRequestException,
			)
		})

		it('should throw InternalServerErrorException when rawBody is missing', async () => {
			const req = { rawBody: undefined }
			await expect(controller.handleStripeWebhook(req as any, 'stripe-sig')).rejects.toThrow(
				InternalServerErrorException,
			)
		})

		it('should throw BadRequestException when stripe signature is invalid', async () => {
			stripeServiceMock.constructWebhookEvent.mockReturnValueOnce(null)

			const req = { rawBody }
			await expect(controller.handleStripeWebhook(req as any, 'bad-sig')).rejects.toThrow(
				BadRequestException,
			)
		})

		it('should throw InternalServerErrorException when webhook processing fails', async () => {
			stripeServiceMock.constructWebhookEvent.mockReturnValueOnce(stripeEvent)
			webhookServiceMock.processStripeWebhook.mockRejectedValueOnce(new Error('processing error'))

			const req = { rawBody }
			await expect(controller.handleStripeWebhook(req as any, 'stripe-sig')).rejects.toThrow(
				InternalServerErrorException,
			)
		})
	})

	describe('handlePagSeguroWebhook (deprecated/disabled)', () => {
		it('should reject with GoneException and never process the payload', async () => {
			await expect(controller.handlePagSeguroWebhook()).rejects.toThrow(GoneException)
			expect(webhookServiceMock.processPagSeguroWebhook).not.toHaveBeenCalled()
		})
	})
})
