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
	UseGuards,
} from '@nestjs/common'
import { ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger'
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard'
import { CheckPlanLimit, PlanLimitsGuard } from '@/modules/subscriptions/guards/plan-limits.guard'
import { ZodValidationPipe } from '../../../shared/pipes/zod-validation.pipe'
import {
	type CreateOrderDto,
	createOrderSchema,
	type OrderItemInputDto,
	orderItemInputSchema,
} from '../dto/create-order.dto'
import { OrdersService } from '../services/orders.service'

@ApiTags('orders')
@Controller('orders')
@UseGuards(JwtAuthGuard)
export class OrdersController {
	constructor(private readonly service: OrdersService) {}

	@Post()
	@HttpCode(HttpStatus.CREATED)
	@UseGuards(PlanLimitsGuard)
	@CheckPlanLimit('order')
	@ApiOperation({ summary: 'Create order with items' })
	@ApiBody({
		schema: {
			example: {
				customer_id: 'cuid',
				order_number: 'ORD-001',
				items: [{ product_id: 1, quantity: 2, unit_price: 1000 }],
				notes: '...',
			},
		},
	})
	async create(@Body(new ZodValidationPipe(createOrderSchema)) body: CreateOrderDto) {
		return this.service.create(body)
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

	@Patch(':id/status')
	@ApiOperation({ summary: 'Update order status' })
	@ApiParam({ name: 'id', type: Number })
	@ApiBody({ schema: { example: { status: 'confirmed' } } })
	async updateStatus(@Param('id') id: string, @Body('status') status: string) {
		return this.service.updateStatus(Number(id), status)
	}

	@Delete(':id')
	@HttpCode(HttpStatus.NO_CONTENT)
	@ApiOperation({ summary: 'Delete order' })
	@ApiParam({ name: 'id', type: Number })
	async delete(@Param('id') id: string) {
		return this.service.delete(Number(id))
	}
}
