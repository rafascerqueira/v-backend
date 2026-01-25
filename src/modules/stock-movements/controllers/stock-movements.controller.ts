import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common'
import { ApiBody, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger'
import { ZodValidationPipe } from '../../../shared/pipes/zod-validation.pipe'
import { StockMovementsService } from '../services/stock-movements.service'
import { createStockMovementSchema, type CreateStockMovementDto } from '../dto/create-stock-movement.dto'

@ApiTags('stock-movements')
@Controller('stock-movements')
export class StockMovementsController {
  constructor(private readonly service: StockMovementsService) {}

  @Get('product/:productId')
  @ApiOperation({ summary: 'List stock movements by product' })
  @ApiParam({ name: 'productId', type: Number })
  async list(@Param('productId') productId: string) {
    return this.service.listByProduct(Number(productId))
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create stock movement and update store stock' })
  @ApiBody({ schema: { example: { movement_type: 'in', reference_type: 'purchase', reference_id: 1, product_id: 1, quantity: 5 } } })
  async create(@Body(new ZodValidationPipe(createStockMovementSchema)) body: CreateStockMovementDto) {
    return this.service.create(body)
  }
}
