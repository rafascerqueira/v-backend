import {
	BadRequestException,
	Body,
	Controller,
	Headers,
	HttpCode,
	HttpStatus,
	InternalServerErrorException,
	Logger,
	Post,
	type RawBodyRequest,
	Req,
} from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import type { FastifyRequest } from 'fastify'
import { Public } from '@/modules/auth/decorators/public.decorator'
import { StripeService } from '../services/stripe.service'
import { WebhookService } from '../services/webhook.service'

@ApiTags('webhooks')
@Controller('webhooks')
export class WebhookController {
	private readonly logger = new Logger(WebhookController.name)

	constructor(
		private readonly webhookService: WebhookService,
		private readonly stripeService: StripeService,
	) {}

	@Post('stripe')
	@Public()
	@HttpCode(HttpStatus.OK)
	@ApiOperation({ summary: 'Handle Stripe webhook events' })
	async handleStripeWebhook(
		@Req() req: RawBodyRequest<FastifyRequest>,
		@Headers('stripe-signature') signature: string,
		@Body() body: any,
	) {
		if (!signature) {
			throw new BadRequestException('Missing Stripe signature header')
		}

		const rawBody = req.rawBody
		if (rawBody) {
			const event = this.stripeService.constructWebhookEvent(rawBody, signature)
			if (!event) {
				throw new BadRequestException('Invalid Stripe webhook signature')
			}
			body = event
		}

		this.logger.log(`Received Stripe webhook: ${body?.type}`)

		try {
			await this.webhookService.processStripeWebhook(body)
			return { received: true }
		} catch (error) {
			this.logger.error(`Stripe webhook error: ${error}`)
			throw new InternalServerErrorException('Webhook processing failed')
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
		if (!signature) {
			throw new BadRequestException('Missing PagSeguro signature header')
		}

		this.logger.log(`Received PagSeguro webhook: ${body?.type}`)

		try {
			await this.webhookService.processPagSeguroWebhook(body)
			return { received: true }
		} catch (error) {
			this.logger.error(`PagSeguro webhook error: ${error}`)
			throw new InternalServerErrorException('Webhook processing failed')
		}
	}
}
