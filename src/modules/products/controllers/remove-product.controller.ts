import { Controller, Delete, Param } from '@nestjs/common'
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger'
import { ProductService } from '../services/product.service'

@ApiTags('products')
@Controller('products')
export class RemoveProductController {
	constructor(private readonly productService: ProductService) {}

	@Delete(':id')
	@ApiOperation({ summary: 'Remove product' })
	@ApiParam({ name: 'id', type: String })
	@ApiResponse({ status: 200, description: 'Product removed successfully' })
	@ApiResponse({ status: 404, description: 'Product not found' })
	async handle(@Param('id') id: string) {
		await this.productService.remove(id)
	}
}
