import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common'
import { ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger'
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard'
import { ProductService } from '../services/product.service'
import { paginationSchema } from '@/shared/dto/pagination.dto'

@ApiTags('products')
@Controller('products')
@UseGuards(JwtAuthGuard)
export class ListProductsController {
	constructor(private readonly productService: ProductService) {}

	@Get()
	@ApiOperation({ summary: 'List all products with pagination and filters' })
	@ApiQuery({ name: 'page', required: false, type: Number })
	@ApiQuery({ name: 'limit', required: false, type: Number })
	@ApiQuery({ name: 'search', required: false, type: String })
	@ApiQuery({ name: 'category', required: false, type: String })
	@ApiQuery({ name: 'status', required: false, type: String })
	@ApiQuery({ name: 'sortBy', required: false, type: String })
	@ApiQuery({ name: 'sortOrder', required: false, enum: ['asc', 'desc'] })
	@ApiResponse({ status: 200, description: 'Products listed successfully' })
	async findAll(@Query() query: Record<string, string>) {
		const params = paginationSchema.parse(query)
		return this.productService.findAllPaginated(params)
	}

	@Get(':id')
	@ApiOperation({ summary: 'Get product by id' })
	@ApiParam({ name: 'id', type: String })
	@ApiResponse({ status: 200, description: 'Product found' })
	@ApiResponse({ status: 404, description: 'Product not found' })
	async findOne(@Param('id') id: string) {
		return this.productService.findById(id)
	}
}
