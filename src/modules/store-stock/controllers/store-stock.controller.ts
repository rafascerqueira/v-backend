import { Body, Controller, Get, Param, Patch } from '@nestjs/common'
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger'
import { ZodValidationPipe } from '../../../shared/pipes/zod-validation.pipe'
import { StoreStockService } from '../services/store-stock.service'
import { updateStoreStockSchema, type UpdateStoreStockDto } from '../dto/update-store-stock.dto'

@ApiTags('store-stock')
@Controller('store-stock')
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
