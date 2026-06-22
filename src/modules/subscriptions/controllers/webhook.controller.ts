import {
	BadRequestException,
	Controller,
	GoneException,
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
import { SkipThrottle } from '@nestjs/throttler'
import type { FastifyRequest } from 'fastify'
import { Public } from '@/modules/auth/decorators/public.decorator'
import { StripeService } from '../services/stripe.service'
import { WebhookService } from '../services/webhook.service'

// Stripe delivers events in bursts (a single checkout fires ~10 events at once) and
// retries aggressively. The global ThrottlerGuard's `short` limit (3 req/s) would 429
// the critical activation events. Skip throttling here — the endpoint is already
// protected by Stripe signature verification + webhook idempotency.
@SkipThrottle()
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
	) {
		if (!signature) {
			throw new BadRequestException('Missing Stripe signature header')
		}

		const rawBody = req.rawBody
		if (!rawBody) {
			throw new InternalServerErrorException('Raw body unavailable')
		}

		const event = this.stripeService.constructWebhookEvent(rawBody, signature)
		if (!event) {
			throw new BadRequestException('Invalid Stripe webhook signature')
		}

		this.logger.log(`Received Stripe webhook: ${event.type}`)

		try {
			await this.webhookService.processStripeWebhook(event)
			return { received: true }
		} catch (error) {
			this.logger.error(`Stripe webhook error: ${error}`)
			throw new InternalServerErrorException('Webhook processing failed')
		}
	}

	/**
	 * @deprecated PagSeguro is no longer used — billing runs entirely on Stripe.
	 * The handler never verified the webhook signature, so it is disabled to prevent
	 * forged subscription events. Returns 410 Gone for any caller.
	 */
	@Post('pagseguro')
	@Public()
	@ApiOperation({ summary: '[DEPRECATED] PagSeguro webhooks are disabled', deprecated: true })
	async handlePagSeguroWebhook() {
		this.logger.warn('Rejected call to deprecated/disabled PagSeguro webhook endpoint')
		throw new GoneException('PagSeguro webhooks are no longer supported')
	}
}
