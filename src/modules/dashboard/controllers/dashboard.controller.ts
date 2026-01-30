import { Controller, Get } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { CurrentUser } from '@/modules/auth/decorators/current-user.decorator'
import type { TokenPayload } from '@/modules/auth/dto/auth-response.dto'
import { DashboardService } from '../services/dashboard.service'

@ApiTags('dashboard')
@ApiBearerAuth()
@Controller('dashboard')
export class DashboardController {
	constructor(private readonly dashboardService: DashboardService) {}

	@Get('stats')
	@ApiOperation({ summary: 'Get dashboard statistics' })
	async getStats(@CurrentUser() user: TokenPayload) {
		return this.dashboardService.getStats(user.sub)
	}
}
