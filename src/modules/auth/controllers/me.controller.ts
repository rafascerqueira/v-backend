import { Controller, Get, NotFoundException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { AccountService } from '@/modules/users/services/account.service'
import { CurrentUser } from '../decorators/current-user.decorator'
import type { TokenPayload } from '../dto/auth-response.dto'
import { resolveAvatarUrl } from '../utils/avatar-url'

@ApiTags('auth')
@ApiBearerAuth()
@Controller('auth')
export class MeController {
	constructor(
		private readonly accountService: AccountService,
		private readonly configService: ConfigService,
	) {}

	@Get('me')
	@ApiOperation({ summary: 'Get current user data' })
	async me(@CurrentUser() user: TokenPayload) {
		const account = await this.accountService.findById(user.sub)

		if (!account) {
			throw new NotFoundException('User not found')
		}

		const appUrl = this.configService.get<string>('appUrl', 'http://localhost:3001')

		return {
			id: account.id,
			name: account.name,
			email: account.email,
			role: account.role,
			planType: account.plan_type,
			avatar: resolveAvatarUrl(account.avatar, appUrl, account.updatedAt),
			phone: account.phone,
			address: account.address,
			two_factor_enabled: account.two_factor_enabled,
			createdAt: account.createdAt,
			updatedAt: account.updatedAt,
		}
	}
}
