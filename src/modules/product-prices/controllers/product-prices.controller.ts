import {
	BadRequestException,
	Body,
	Controller,
	Delete,
	Get,
	HttpCode,
	HttpStatus,
	Param,
	Patch,
	Post,
} from '@nestjs/common'
import { ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger'
import { ZodValidationPipe } from '../../../shared/pipes/zod-validation.pipe'
import {
	type CreateProductPriceDto,
	createProductPriceSchema,
} from '../dto/create-product-price.dto'
import {
	type UpdateProductPriceDto,
	updateProductPriceSchema,
} from '../dto/update-product-price.dto'
import { ProductPricesService } from '../services/product-prices.service'

@ApiTags('product-prices')
@Controller()
export class ProductPricesController {
	constructor(private readonly service: ProductPricesService) {}

	@Get('products/:productId/prices')
	@ApiOperation({ summary: 'List prices for a product' })
	@ApiParam({ name: 'productId', type: Number })
	async list(@Param('productId') productId: string) {
		return this.service.listByProduct(Number(productId))
	}

	@Post('products/:productId/prices')
	@HttpCode(HttpStatus.CREATED)
	@ApiOperation({ summary: 'Create a price for a product' })
	@ApiParam({ name: 'productId', type: Number })
	@ApiResponse({ status: 201, description: 'Price created' })
	@ApiBody({
		schema: {
			example: {
				price: 1000,
				price_type: 'sale',
				valid_from: '2025-01-01T00:00:00.000Z',
				valid_to: '2025-12-31T23:59:59.000Z',
				active: true,
			},
		},
	})
	async create(
		@Param('productId') productId: string,
		@Body(new ZodValidationPipe(createProductPriceSchema)) body: CreateProductPriceDto,
	) {
		return this.service.create(Number(productId), body)
	}

	@Patch('product-prices/:id')
	@ApiOperation({ summary: 'Update a product price' })
	@ApiParam({ name: 'id', type: Number })
	@ApiBody({
		schema: {
			example: {
				price: 1200,
				valid_to: null,
			},
		},
	})
	async update(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(updateProductPriceSchema)) body: UpdateProductPriceDto,
	) {
		return this.service.update(Number(id), body)
	}

	@Delete('product-prices/:id')
	@ApiOperation({ summary: 'Deactivate (soft-delete) a product price' })
	@ApiParam({ name: 'id', type: Number })
	@ApiResponse({ status: 200, description: 'Price deactivated' })
	async deactivate(@Param('id') id: string) {
		return this.service.deactivate(Number(id))
	}
}
