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
	UseGuards,
} from '@nestjs/common'
import { ApiBody, ApiHeader, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger'
import { z } from 'zod'
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard'
import { CheckPlanLimit, PlanLimitsGuard } from '@/modules/subscriptions/guards/plan-limits.guard'
import { IdempotencyKey } from '@/shared/idempotency/idempotency-key.decorator'
import { ZodValidationPipe } from '../../../shared/pipes/zod-validation.pipe'
import {
	type CreateOrderDto,
	createOrderSchema,
	type OrderItemInputDto,
	orderItemInputSchema,
} from '../dto/create-order.dto'
import { OrdersService } from '../services/orders.service'

const updateStatusSchema = z.object({
	status: z.enum(['pending', 'confirmed', 'shipping', 'delivered', 'canceled']),
})
type UpdateStatusDto = z.infer<typeof updateStatusSchema>

@ApiTags('orders')
@Controller('orders')
@UseGuards(JwtAuthGuard)
export class OrdersController {
	constructor(private readonly service: OrdersService) {}

	@Post()
	@HttpCode(HttpStatus.CREATED)
	@UseGuards(PlanLimitsGuard)
	@CheckPlanLimit('order')
	@ApiOperation({
		summary: 'Create order with items',
		description:
			'The server numbers the order (PED-000123); order_number in the body is ignored. ' +
			'Send an Idempotency-Key header to make retries safe: the same key and body ' +
			'return the original order; the same key with another body answers 422.',
	})
	@ApiHeader({ name: 'Idempotency-Key', required: false, description: 'Up to 64 [A-Za-z0-9_-]' })
	@ApiBody({
		schema: {
			example: {
				customer_id: 'cuid',
				items: [{ product_id: 1, quantity: 2, unit_price: 1000 }],
				notes: '...',
			},
		},
	})
	async create(
		@Body(new ZodValidationPipe(createOrderSchema)) body: CreateOrderDto,
		@IdempotencyKey() idempotencyKey?: string,
	) {
		return this.service.create(body, idempotencyKey)
	}

	@Post(':orderId/items')
	@ApiOperation({ summary: 'Add item to order' })
	@ApiParam({ name: 'orderId', type: Number })
	@ApiBody({ schema: { example: { product_id: 1, quantity: 1, unit_price: 1000, discount: 0 } } })
	async addItem(
		@Param('orderId') orderId: string,
		@Body(new ZodValidationPipe(orderItemInputSchema)) body: OrderItemInputDto,
	) {
		return this.service.addItem(Number(orderId), body)
	}

	@Get()
	@ApiOperation({ summary: 'List all orders' })
	async findAll() {
		return this.service.findAll()
	}

	@Get(':id')
	@ApiOperation({ summary: 'Get order by id' })
	@ApiParam({ name: 'id', type: Number })
	async get(@Param('id') id: string) {
		return this.service.findById(Number(id))
	}

	@Get(':id/events')
	@ApiOperation({ summary: "Order timeline: the order's domain events, oldest first" })
	@ApiParam({ name: 'id', type: Number })
	async events(@Param('id', ParseIntPipe) id: number) {
		return this.service.findEvents(id)
	}

	@Patch(':id/status')
	@ApiOperation({ summary: 'Update order status' })
	@ApiParam({ name: 'id', type: Number })
	@ApiBody({ schema: { example: { status: 'confirmed' } } })
	async updateStatus(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(updateStatusSchema)) body: UpdateStatusDto,
	) {
		return this.service.updateStatus(Number(id), body.status)
	}

	@Delete(':id')
	@HttpCode(HttpStatus.NO_CONTENT)
	@ApiOperation({ summary: 'Delete order' })
	@ApiParam({ name: 'id', type: Number })
	async delete(@Param('id') id: string) {
		return this.service.delete(Number(id))
	}
}
