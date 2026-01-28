import { Body, Controller, Param, Patch, UseGuards } from '@nestjs/common'
import { ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger'
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard'
import { ZodValidationPipe } from '@/shared/pipes/zod-validation.pipe'
import { type UpdateProductDto, updateProductSchema } from '../dto/update-product.dto'
import { ProductService } from '../services/product.service'

@ApiTags('products')
@Controller('products')
@UseGuards(JwtAuthGuard)
export class UpdateProductController {
	constructor(private readonly productService: ProductService) {}

	@Patch(':id')
	@ApiOperation({ summary: 'Update product' })
	@ApiParam({ name: 'id', type: String })
	@ApiResponse({ status: 200, description: 'Product updated successfully' })
	@ApiResponse({ status: 400, description: 'Validation error' })
	@ApiResponse({ status: 404, description: 'Product not found' })
	@ApiBody({
		schema: {
			example: {
				name: 'New name',
				description: 'New description',
				active: true,
			},
		},
	})
	async handle(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(updateProductSchema)) body: UpdateProductDto,
	) {
		return this.productService.update(id, body)
	}
}
