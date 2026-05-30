import { Controller, HttpCode, HttpStatus, Param, Post, Req, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger'
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard'
import { CatalogService } from '../services/catalog.service'

@ApiTags('store')
@ApiBearerAuth()
@Controller('store/customers')
@UseGuards(JwtAuthGuard)
export class CustomerInviteController {
	constructor(private readonly service: CatalogService) {}

	@Post(':customerId/password-invite')
	@HttpCode(HttpStatus.CREATED)
	@ApiOperation({
		summary: 'Generate a one-time link for a customer to set or reset their password',
	})
	@ApiParam({ name: 'customerId', type: String, description: 'Customer UUID' })
	@ApiResponse({
		status: 201,
		description: 'Invite created; returns token, shareable link, and isReset flag',
	})
	@ApiResponse({ status: 404, description: 'Customer not found in your store' })
	async createInvite(@Req() req: any, @Param('customerId') customerId: string) {
		return this.service.createCustomerPasswordInvite(req.user.sub, customerId)
	}
}
