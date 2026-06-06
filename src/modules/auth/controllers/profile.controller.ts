import { Body, Controller, Patch } from '@nestjs/common'
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger'
import { z } from 'zod'
import { AccountService } from '@/modules/users/services/account.service'
import { ZodValidationPipe } from '@/shared/pipes/zod-validation.pipe'
import { CurrentUser } from '../decorators/current-user.decorator'
import type { TokenPayload } from '../dto/auth-response.dto'

// `avatar` is intentionally NOT settable here. It is managed exclusively by the
// avatar endpoints (POST/DELETE /auth/profile/avatar), which set the private
// storage key server-side — a client must never be able to point its avatar at
// an arbitrary key or another user's image.
const updateProfileSchema = z.object({
	name: z.string().min(2).max(100).optional(),
	phone: z.string().max(20).nullish(),
	address: z.string().max(255).nullish(),
})
type UpdateProfileDto = z.infer<typeof updateProfileSchema>

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
		@Body(new ZodValidationPipe(updateProfileSchema)) body: UpdateProfileDto,
	) {
		return this.accountService.updateProfile(user.sub, body)
	}
}
