import { Body, Controller, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard'
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { ProductService } from '../services/product.service'
import { ZodValidationPipe } from '@/shared/pipes/zod-validation.pipe'
import { createProductSchema, type CreateProductDto } from '../dto/create-product.dto'

@ApiTags('products')
@Controller('product/create-product')
@UseGuards(JwtAuthGuard)
export class CreateProductController {
	constructor(private readonly productService: ProductService) {}

	@Post()
	@HttpCode(HttpStatus.CREATED)
	@ApiOperation({ summary: 'Create product' })
	@ApiResponse({ status: 201, description: 'Product created successfully' })
	@ApiResponse({ status: 400, description: 'Validation error' })
	@ApiBody({
		schema: {
			example: {
				name: 'Product Name',
				description: 'Product Description',
				sku: 'SKU-001',
				category: 'Category',
				brand: 'Brand',
				unit: 'un',
				specifications: { imported: false, moreinfo: '...' },
				images: ['https://example.com/image1.jpg'],
				active: true,
			},
		},
	})
	async handle(
		@Body(new ZodValidationPipe(createProductSchema)) body: CreateProductDto,
		@Req() req: any,
	) {
		return this.productService.create({ ...body, seller_id: req.user.sub })
	}
}
