import { Controller, Get, Query } from '@nestjs/common'
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger'
import { ReportsService } from '../services/reports.service'

@ApiTags('reports')
@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('sales')
  @ApiOperation({ summary: 'Get sales report by period' })
  @ApiQuery({ name: 'startDate', required: false, type: String })
  @ApiQuery({ name: 'endDate', required: false, type: String })
  async getSalesReport(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.reportsService.getSalesReport(startDate, endDate)
  }

  @Get('products')
  @ApiOperation({ summary: 'Get top products report' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async getProductsReport(@Query('limit') limit?: string) {
    return this.reportsService.getProductsReport(limit ? parseInt(limit) : 10)
  }

  @Get('customers')
  @ApiOperation({ summary: 'Get top customers report' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async getCustomersReport(@Query('limit') limit?: string) {
    return this.reportsService.getCustomersReport(limit ? parseInt(limit) : 10)
  }
}
