import { Body, Controller, Patch } from '@nestjs/common'
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { AccountService } from '@/modules/users/services/account.service'
import { CurrentUser } from '../decorators/current-user.decorator'
import type { TokenPayload } from '../dto/auth-response.dto'

@ApiTags('auth')
@ApiBearerAuth()
@Controller('auth')
export class ProfileController {
	constructor(private readonly accountService: AccountService) {}

	@Patch('profile')
	@ApiOperation({ summary: 'Update user profile' })
	@ApiBody({ schema: { example: { name: 'John Doe' } } })
	async updateProfile(@CurrentUser() user: TokenPayload, @Body() body: { name?: string }) {
		return this.accountService.updateProfile(user.sub, body)
	}
}
