import { Controller, Patch, Body } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiBearerAuth, ApiBody } from '@nestjs/swagger'
import { CurrentUser } from '../decorators/current-user.decorator'
import type { TokenPayload } from '../dto/auth-response.dto'
import { AccountService } from '@/modules/users/services/account.service'

@ApiTags('auth')
@ApiBearerAuth()
@Controller('auth')
export class ProfileController {
	constructor(private readonly accountService: AccountService) {}

	@Patch('profile')
	@ApiOperation({ summary: 'Update user profile' })
	@ApiBody({ schema: { example: { name: 'John Doe' } } })
	async updateProfile(
		@CurrentUser() user: TokenPayload,
		@Body() body: { name?: string },
	) {
		return this.accountService.updateProfile(user.sub, body)
	}
}
