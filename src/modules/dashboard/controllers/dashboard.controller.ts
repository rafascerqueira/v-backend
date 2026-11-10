import { Controller, Get } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { CurrentUser } from '@/modules/auth/decorators/current-user.decorator'
import type { AuthenticatedUser } from '@/modules/auth/session/session.types'
import { DashboardService } from '../services/dashboard.service'

@ApiTags('dashboard')
@ApiBearerAuth()
@Controller('dashboard')
export class DashboardController {
	constructor(private readonly dashboardService: DashboardService) {}

	@Get('stats')
	@ApiOperation({ summary: 'Get dashboard statistics' })
	async getStats(@CurrentUser() user: AuthenticatedUser) {
		return this.dashboardService.getStats(user.sub)
	}
}
