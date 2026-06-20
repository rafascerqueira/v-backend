import {
	Body,
	Controller,
	Delete,
	Get,
	HttpCode,
	HttpStatus,
	Param,
	Patch,
	Post,
	Query,
} from '@nestjs/common'
import { ApiBody, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger'
import { ZodValidationPipe } from '../../../shared/pipes/zod-validation.pipe'
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

	@Patch('billings/:id')
	@ApiOperation({ summary: 'Update billing (status/payment_status are derived from amounts)' })
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
	async remove(@Param('id') id: string) {
		return this.service.delete(Number(id))
	}
}
