import { Controller, Get, Post, Body, Param, Patch, Delete, Query, Req, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard'
import { ApiTags, ApiOperation, ApiResponse, ApiBody, ApiParam, ApiQuery } from '@nestjs/swagger'
import { CustomersService } from '../services/customers.service'
import { CreateCustomerDto, createCustomerSchema } from '../dto/create-customer.dto'
import { ZodValidationPipe } from '@/shared/pipes/zod-validation.pipe'
import { paginationSchema } from '@/shared/dto/pagination.dto'

@ApiTags('customers')
@Controller('customers')
@UseGuards(JwtAuthGuard)
export class CustomersController {
	constructor(private readonly customersService: CustomersService) {}

	@Post()
	@ApiOperation({ summary: 'Create a new customer' })
	@ApiResponse({ status: 201, description: 'Customer created successfully' })
	@ApiResponse({ status: 409, description: 'Email or phone already exists' })
	@ApiBody({
		schema: {
			example: {
				name: 'John Doe',
				email: 'john@example.com',
				phone: '+55 11 99999-9999',
				address: 'Rua Exemplo, 123',
			},
		},
	})
	create(
		@Body(new ZodValidationPipe(createCustomerSchema)) data: CreateCustomerDto,
		@Req() req: any,
	) {
		return this.customersService.create({ ...data, seller_id: req.user.sub })
	}

	@Get()
	@ApiOperation({ summary: 'List all customers with pagination and filters' })
	@ApiQuery({ name: 'page', required: false, type: Number })
	@ApiQuery({ name: 'limit', required: false, type: Number })
	@ApiQuery({ name: 'search', required: false, type: String })
	@ApiQuery({ name: 'status', required: false, enum: ['active', 'inactive'] })
	@ApiQuery({ name: 'sortBy', required: false, type: String })
	@ApiQuery({ name: 'sortOrder', required: false, enum: ['asc', 'desc'] })
	findAll(@Query() query: Record<string, string>) {
		const params = paginationSchema.parse(query)
		return this.customersService.findAllPaginated(params)
	}

	@Get(':id')
	@ApiOperation({ summary: 'Get customer by id' })
	@ApiResponse({ status: 404, description: 'Customer not found' })
	@ApiParam({ name: 'id', type: String })
	findOne(@Param('id') id: string) {
		return this.customersService.findOne(id)
	}

	@Patch(':id')
	@ApiOperation({ summary: 'Update customer' })
	@ApiParam({ name: 'id', type: String })
	@ApiBody({
		schema: {
			example: {
				name: 'Jane Doe',
				email: 'jane@example.com',
			},
		},
	})
	update(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(createCustomerSchema.partial())) data: Partial<CreateCustomerDto>
	) {
		return this.customersService.update(id, data)
	}

	@Delete(':id')
	@ApiOperation({ summary: 'Delete customer' })
	@ApiParam({ name: 'id', type: String })
	remove(@Param('id') id: string) {
		return this.customersService.remove(id)
	}
}
