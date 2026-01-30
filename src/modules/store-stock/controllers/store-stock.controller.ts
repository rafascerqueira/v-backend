import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common'
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger'
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard'
import { ZodValidationPipe } from '../../../shared/pipes/zod-validation.pipe'
import { type UpdateStoreStockDto, updateStoreStockSchema } from '../dto/update-store-stock.dto'
import { StoreStockService } from '../services/store-stock.service'

@ApiTags('store-stock')
@Controller('store-stock')
@UseGuards(JwtAuthGuard)
export class StoreStockController {
	constructor(private readonly service: StoreStockService) {}

	@Get()
	@ApiOperation({ summary: 'List all store stock' })
	async findAll() {
		return this.service.findAll()
	}

	@Get(':productId')
	@ApiOperation({ summary: 'Get store stock by productId' })
	@ApiParam({ name: 'productId', type: Number })
	async get(@Param('productId') productId: string) {
		return this.service.getByProduct(Number(productId))
	}

	@Patch(':productId')
	@ApiOperation({ summary: 'Upsert store stock for productId' })
	@ApiParam({ name: 'productId', type: Number })
	async upsert(
		@Param('productId') productId: string,
		@Body(new ZodValidationPipe(updateStoreStockSchema)) body: UpdateStoreStockDto,
	) {
		return this.service.upsert(Number(productId), body)
	}
}
