import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common'
import { ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger'
import { Public } from '@/modules/auth/decorators/public.decorator'
import { ZodValidationPipe } from '@/shared/pipes/zod-validation.pipe'
import {
	type CreateCatalogOrderDto,
	createCatalogOrderSchema,
} from '../dto/create-catalog-order.dto'
import type { CatalogService } from '../services/catalog.service'

@ApiTags('catalog')
@Controller('catalog')
export class CatalogController {
	constructor(private readonly service: CatalogService) {}

	@Public()
	@Get('products')
	@ApiOperation({ summary: 'List all products available in catalog (public)' })
	@ApiResponse({ status: 200, description: 'Products listed successfully' })
	async getProducts() {
		return this.service.getProducts()
	}

	@Public()
	@Get('products/:id')
	@ApiOperation({ summary: 'Get product details (public)' })
	@ApiParam({ name: 'id', type: Number })
	@ApiResponse({ status: 200, description: 'Product found' })
	@ApiResponse({ status: 404, description: 'Product not found' })
	async getProduct(@Param('id') id: string) {
		return this.service.getProductById(Number(id))
	}

	@Public()
	@Get('customers/:id')
	@ApiOperation({ summary: 'Get customer data for personalized catalog link (public)' })
	@ApiParam({ name: 'id', type: String, description: 'Customer UUID' })
	@ApiResponse({ status: 200, description: 'Customer found' })
	@ApiResponse({ status: 404, description: 'Customer not found' })
	async getCustomer(@Param('id') id: string) {
		return this.service.getCustomerById(id)
	}

	@Public()
	@Post('orders')
	@HttpCode(HttpStatus.CREATED)
	@ApiOperation({ summary: 'Create order from catalog (public)' })
	@ApiBody({
		schema: {
			example: {
				customer: {
					name: 'João Silva',
					email: 'joao@email.com',
					phone: '11999999999',
					document: '12345678900',
					address: 'Rua das Flores',
					number: '123',
					complement: 'Apto 45',
					neighborhood: 'Centro',
					city: 'São Paulo',
					state: 'SP',
					zip_code: '01234567',
				},
				items: [{ product_id: 1, quantity: 2 }],
				notes: 'Entregar pela manhã',
			},
		},
	})
	@ApiResponse({ status: 201, description: 'Order created successfully' })
	@ApiResponse({ status: 400, description: 'Invalid data' })
	async createOrder(
		@Body(new ZodValidationPipe(createCatalogOrderSchema)) body: CreateCatalogOrderDto,
	) {
		return this.service.createOrder(body)
	}
}
