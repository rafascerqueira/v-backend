import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common'
import { ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger'
import { ZodValidationPipe } from '../../../shared/pipes/zod-validation.pipe'
import { BillingsService } from '../services/billings.service'
import { createBillingSchema, type CreateBillingDto } from '../dto/create-billing.dto'
import { updateBillingSchema, type UpdateBillingDto } from '../dto/update-billing.dto'

@ApiTags('billings')
@Controller()
export class BillingsController {
  constructor(private readonly service: BillingsService) {}

  @Get('billings')
  @ApiOperation({ summary: 'List all billings' })
  async findAll() {
    return this.service.findAll()
  }

  @Get('orders/:orderId/billings')
  @ApiOperation({ summary: 'List billings for order' })
  @ApiParam({ name: 'orderId', type: Number })
  async list(@Param('orderId') orderId: string) {
    return this.service.listByOrder(Number(orderId))
  }

  @Post('orders/:orderId/billings')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create billing for order' })
  @ApiParam({ name: 'orderId', type: Number })
  @ApiResponse({ status: 201, description: 'Billing created' })
  @ApiBody({ schema: { example: { billing_number: 'BILL-001', total_amount: 1000, paid_amount: 0, status: 'pending' } } })
  async create(
    @Param('orderId') orderId: string,
    @Body(new ZodValidationPipe(createBillingSchema)) body: CreateBillingDto,
  ) {
    return this.service.create(Number(orderId), body)
  }

  @Patch('billings/:id')
  @ApiOperation({ summary: 'Update billing' })
  @ApiParam({ name: 'id', type: Number })
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateBillingSchema)) body: UpdateBillingDto,
  ) {
    return this.service.update(Number(id), body)
  }
}
