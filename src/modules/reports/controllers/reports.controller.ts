import { Controller, Get, Query, UseGuards } from '@nestjs/common'
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger'
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard'
import { ReportsService } from '../services/reports.service'

@ApiTags('reports')
@Controller('reports')
@UseGuards(JwtAuthGuard)
export class ReportsController {
	constructor(private readonly reportsService: ReportsService) {}

	@Get()
	@ApiOperation({ summary: 'Get full report for dashboard' })
	@ApiQuery({ name: 'period', required: false, enum: ['week', 'month', 'year'] })
	async getFullReport(@Query('period') period?: 'week' | 'month' | 'year') {
		return this.reportsService.getFullReport(period || 'month')
	}

	@Get('sales')
	@ApiOperation({ summary: 'Get sales report by period' })
	@ApiQuery({ name: 'startDate', required: false, type: String })
	@ApiQuery({ name: 'endDate', required: false, type: String })
	async getSalesReport(@Query('startDate') startDate?: string, @Query('endDate') endDate?: string) {
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

	@Get('charts')
	@ApiOperation({ summary: 'Get charts data for analytics' })
	@ApiQuery({ name: 'period', required: false, enum: ['week', 'month', 'year'] })
	async getChartsData(@Query('period') period?: 'week' | 'month' | 'year') {
		return this.reportsService.getChartsData(period || 'month')
	}

	@Get('growth')
	@ApiOperation({ summary: 'Get growth metrics (current vs previous month)' })
	async getGrowthMetrics() {
		return this.reportsService.getGrowthMetrics()
	}
}
