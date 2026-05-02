import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common'
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { z } from 'zod'
import { AccountService } from '@/modules/users/services/account.service'
import { ZodValidationPipe } from '@/shared/pipes/zod-validation.pipe'
import { CurrentUser } from '../decorators/current-user.decorator'
import type { TokenPayload } from '../dto/auth-response.dto'

const changePasswordSchema = z.object({
	currentPassword: z.string().min(1),
	newPassword: z.string().min(8),
})
type ChangePasswordDto = z.infer<typeof changePasswordSchema>

@ApiTags('auth')
@ApiBearerAuth()
@Controller('auth')
export class ChangePasswordController {
	constructor(private readonly accountService: AccountService) {}

	@Post('change-password')
	@HttpCode(HttpStatus.OK)
	@ApiOperation({ summary: 'Change authenticated user password' })
	@ApiBody({ schema: { example: { currentPassword: 'OldPass123', newPassword: 'NewPass123' } } })
	@ApiResponse({ status: 200, description: 'Password changed successfully' })
	@ApiResponse({ status: 401, description: 'Current password is incorrect' })
	async changePassword(
		@CurrentUser() user: TokenPayload,
		@Body(new ZodValidationPipe(changePasswordSchema)) body: ChangePasswordDto,
	) {
		await this.accountService.changePassword(user.sub, body.currentPassword, body.newPassword)
		return { message: 'Senha alterada com sucesso' }
	}
}
