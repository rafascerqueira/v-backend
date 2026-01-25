import { Controller, Get, NotFoundException } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger'
import { CurrentUser } from '../decorators/current-user.decorator'
import type { TokenPayload } from '../dto/auth-response.dto'
import { AccountService } from '@/modules/users/services/account.service'

@ApiTags('auth')
@ApiBearerAuth()
@Controller('auth')
export class MeController {
	constructor(private readonly accountService: AccountService) {}

	@Get('me')
	@ApiOperation({ summary: 'Get current user data' })
	async me(@CurrentUser() user: TokenPayload) {
		const account = await this.accountService.findById(user.sub)

		if (!account) {
			throw new NotFoundException('User not found')
		}

		return {
			id: account.id,
			name: account.name,
			email: account.email,
			role: account.role,
			planType: account.plan_type,
			createdAt: account.createdAt,
			updatedAt: account.updatedAt,
		}
	}
}
