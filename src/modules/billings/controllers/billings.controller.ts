import {
	Body,
	Controller,
	Delete,
	Get,
	HttpCode,
	HttpStatus,
	Param,
	ParseIntPipe,
	Patch,
	Post,
	Query,
} from '@nestjs/common'
import {
	ApiBody,
	ApiHeader,
	ApiOperation,
	ApiParam,
	ApiQuery,
	ApiResponse,
	ApiTags,
} from '@nestjs/swagger'
import { IdempotencyKey } from '@/shared/idempotency/idempotency-key.decorator'
import { ZodValidationPipe } from '../../../shared/pipes/zod-validation.pipe'
import {
	type RecordPaymentDto,
	type ReversePaymentDto,
	recordPaymentSchema,
	reversePaymentSchema,
} from '../dto/billing-payment.dto'
import { type CreateBillingDto, createBillingSchema } from '../dto/create-billing.dto'
import { type UpdateBillingDto, updateBillingSchema } from '../dto/update-billing.dto'
import { BillingsService } from '../services/billings.service'

@ApiTags('billings')
@Controller()
export class BillingsController {
	constructor(private readonly service: BillingsService) {}

	@Get('billings')
	@ApiOperation({ summary: 'List all billings' })
	@ApiQuery({
		name: 'status',
		required: false,
		enum: ['pending', 'partial', 'paid', 'overdue', 'canceled'],
	})
	async findAll(@Query('status') status?: string) {
		return this.service.findAll(status)
	}

	@Post('billings/sync')
	@HttpCode(HttpStatus.OK)
	@ApiOperation({ summary: 'Sync billings for per_sale orders without billing' })
	@ApiResponse({ status: 200, description: 'Sync result with created count' })
	async sync() {
		return this.service.syncBillings()
	}

	@Get('orders/:orderId/billings')
	@ApiOperation({ summary: 'List billings for order' })
	@ApiParam({ name: 'orderId', type: Number })
	async list(@Param('orderId') orderId: string) {
		return this.service.listByOrder(Number(orderId))
	}

	@Post('orders/:orderId/billings')
	@HttpCode(HttpStatus.CREATED)
	@ApiOperation({ summary: 'Create billing for order' })
	@ApiParam({ name: 'orderId', type: Number })
	@ApiResponse({ status: 201, description: 'Billing created' })
	@ApiBody({
		schema: {
			example: {
				billing_number: 'BILL-001',
				total_amount: 1000,
				paid_amount: 0,
			},
		},
	})
	async create(
		@Param('orderId') orderId: string,
		@Body(new ZodValidationPipe(createBillingSchema)) body: CreateBillingDto,
	) {
		return this.service.create(Number(orderId), body)
	}

	@Get('billings/:id/payments')
	@ApiOperation({ summary: "The charge's ledger: payments and reversals, oldest first" })
	@ApiParam({ name: 'id', type: Number })
	@ApiResponse({ status: 404, description: 'Billing not found' })
	async listPayments(@Param('id', ParseIntPipe) id: number) {
		return this.service.listPayments(id)
	}

	@Post('billings/:id/payments')
	@HttpCode(HttpStatus.CREATED)
	@ApiOperation({
		summary: 'Record money received (append-only ledger)',
		description:
			'amount is what was received now, in cents (not a new total). 400 when it exceeds ' +
			'the open balance or the charge is canceled. Returns { payment, billing }.',
	})
	@ApiParam({ name: 'id', type: Number })
	@ApiHeader({ name: 'Idempotency-Key', required: false, description: '16-64 [A-Za-z0-9_-]' })
	@ApiBody({ schema: { example: { amount: 1500, method: 'pix', note: 'Sinal' } } })
	async recordPayment(
		@Param('id', ParseIntPipe) id: number,
		@Body(new ZodValidationPipe(recordPaymentSchema)) body: RecordPaymentDto,
		@IdempotencyKey() idempotencyKey?: string,
	) {
		return this.service.recordPayment(id, body, idempotencyKey)
	}

	@Post('billings/:id/payments/:paymentId/reverse')
	@HttpCode(HttpStatus.CREATED)
	@ApiOperation({
		summary: 'Reverse a payment (refund / correction). Returns { reversal, billing }.',
		description: '409 ALREADY_REVERSED; 400 when the entry is itself a reversal.',
	})
	@ApiParam({ name: 'id', type: Number })
	@ApiParam({ name: 'paymentId', type: Number })
	@ApiHeader({ name: 'Idempotency-Key', required: false, description: '16-64 [A-Za-z0-9_-]' })
	@ApiBody({ schema: { example: { reason: 'Pagamento lançado em duplicidade' } } })
	async reversePayment(
		@Param('id', ParseIntPipe) id: number,
		@Param('paymentId', ParseIntPipe) paymentId: number,
		@Body(new ZodValidationPipe(reversePaymentSchema)) body: ReversePaymentDto,
		@IdempotencyKey() idempotencyKey?: string,
	) {
		return this.service.reversePayment(id, paymentId, body, idempotencyKey)
	}

	@Patch('billings/:id')
	@ApiOperation({
		summary: 'Update billing (status/payment_status are derived from amounts)',
		description:
			'paid_amount and payment_date are DEPRECATED: use POST /billings/:id/payments. ' +
			'A higher paid_amount is recorded as a payment of the difference; a lower one is a 400.',
	})
	@ApiParam({ name: 'id', type: Number })
	async update(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(updateBillingSchema)) body: UpdateBillingDto,
	) {
		return this.service.update(Number(id), body)
	}

	@Patch('billings/:id/cancel')
	@ApiOperation({ summary: 'Cancel (void) a billing' })
	@ApiParam({ name: 'id', type: Number })
	@ApiResponse({ status: 200, description: 'Billing canceled' })
	@ApiResponse({ status: 404, description: 'Billing not found' })
	async cancel(@Param('id') id: string) {
		return this.service.cancel(Number(id))
	}

	@Delete('billings/:id')
	@HttpCode(HttpStatus.NO_CONTENT)
	@ApiOperation({ summary: 'Delete billing' })
	@ApiParam({ name: 'id', type: Number })
	@ApiResponse({ status: 204, description: 'Billing deleted' })
	@ApiResponse({ status: 404, description: 'Billing not found' })
	@ApiResponse({ status: 409, description: 'HAS_PAYMENTS: cancel it instead' })
	async remove(@Param('id') id: string) {
		return this.service.delete(Number(id))
	}
}
