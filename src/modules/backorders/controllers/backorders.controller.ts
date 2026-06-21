import { Controller, Get, Query, UseGuards } from '@nestjs/common'
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger'
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard'
import { listBackordersSchema } from '../dto/list-backorders.dto'
import { BackordersService } from '../services/backorders.service'

@ApiTags('backorders')
@Controller('backorders')
@UseGuards(JwtAuthGuard)
export class BackordersController {
	constructor(private readonly service: BackordersService) {}

	@Get()
	@ApiOperation({ summary: 'List backorders (units sold past stock, awaiting restock)' })
	@ApiQuery({ name: 'product_id', required: false, type: Number })
	@ApiQuery({ name: 'status', required: false, enum: ['pending', 'fulfilled', 'canceled'] })
	@ApiResponse({ status: 200, description: 'Backorders listed successfully' })
	async list(@Query() query: Record<string, string>) {
		const params = listBackordersSchema.parse(query)
		return this.service.list(params)
	}
}
