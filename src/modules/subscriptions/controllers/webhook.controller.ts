import {
	Body,
	Controller,
	Headers,
	HttpCode,
	HttpStatus,
	Logger,
	Post,
	type RawBodyRequest,
	Req,
} from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import type { FastifyRequest } from 'fastify'
import { Public } from '@/modules/auth/decorators/public.decorator'
import { WebhookService } from '../services/webhook.service'

@ApiTags('webhooks')
@Controller('webhooks')
export class WebhookController {
	private readonly logger = new Logger(WebhookController.name)

	constructor(private readonly webhookService: WebhookService) {}

	@Post('stripe')
	@Public()
	@HttpCode(HttpStatus.OK)
	@ApiOperation({ summary: 'Handle Stripe webhook events' })
	async handleStripeWebhook(
		@Req() req: RawBodyRequest<FastifyRequest>,
		@Headers('stripe-signature') signature: string,
		@Body() body: any,
	) {
		this.logger.log(`Received Stripe webhook: ${body?.type}`)

		// In production, verify signature using Stripe SDK:
		// const event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret)

		// For now, we'll process the body directly
		// TODO: Add signature verification in production
		if (!signature) {
			this.logger.warn('Missing Stripe signature header')
		}

		try {
			await this.webhookService.processStripeWebhook(body)
			return { received: true }
		} catch (error) {
			this.logger.error(`Stripe webhook error: ${error}`)
			return { received: true, error: 'Processing failed' }
		}
	}

	@Post('pagseguro')
	@Public()
	@HttpCode(HttpStatus.OK)
	@ApiOperation({ summary: 'Handle PagSeguro webhook events' })
	async handlePagSeguroWebhook(
		@Body() body: any,
		@Headers('x-pagseguro-signature') signature: string,
	) {
		this.logger.log(`Received PagSeguro webhook: ${body?.type}`)

		// TODO: Add signature verification in production
		if (!signature) {
			this.logger.warn('Missing PagSeguro signature header')
		}

		try {
			await this.webhookService.processPagSeguroWebhook(body)
			return { received: true }
		} catch (error) {
			this.logger.error(`PagSeguro webhook error: ${error}`)
			return { received: true, error: 'Processing failed' }
		}
	}
}
