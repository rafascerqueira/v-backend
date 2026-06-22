import { Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common'
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { Roles } from '@/modules/auth/decorators/roles.decorator'
import { RolesGuard } from '@/modules/auth/guards/roles.guard'
import { SubscriptionReconcileService } from '../services/subscription-reconcile.service'

@ApiTags('admin')
@Controller('admin/subscriptions')
@UseGuards(RolesGuard)
@Roles('admin')
export class AdminSubscriptionController {
	constructor(private readonly reconcileService: SubscriptionReconcileService) {}

	@Post('reconcile')
	@HttpCode(HttpStatus.OK)
	@ApiOperation({
		summary: 'Reconcile local subscriptions/plans against Stripe (admin only)',
	})
	@ApiResponse({ status: 200, description: 'Reconciliation summary' })
	async reconcile() {
		return this.reconcileService.reconcile()
	}
}
