import { Body, Controller, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common'
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { AccountService } from '@/modules/users/services/account.service'
import { ZodValidationPipe } from '@/shared/pipes/zod-validation.pipe'
import { CurrentUser } from '../decorators/current-user.decorator'
import { SessionService } from '../services/session.service'
import type { AuthenticatedUser } from '../session/session.types'
import { setSessionCookies } from '../utils/session-cookies'

const changePasswordSchema = z.object({
	currentPassword: z.string().min(1),
	newPassword: z.string().min(8),
})
type ChangePasswordDto = z.infer<typeof changePasswordSchema>

@ApiTags('auth')
@ApiBearerAuth()
@Controller('auth')
export class ChangePasswordController {
	constructor(
		private readonly accountService: AccountService,
		private readonly sessionService: SessionService,
	) {}

	@Post('change-password')
	@HttpCode(HttpStatus.OK)
	@ApiOperation({ summary: 'Change authenticated user password' })
	@ApiBody({ schema: { example: { currentPassword: 'OldPass123', newPassword: 'NewPass123' } } })
	@ApiResponse({ status: 200, description: 'Password changed successfully' })
	@ApiResponse({ status: 401, description: 'Current password is incorrect' })
	async changePassword(
		@CurrentUser() user: AuthenticatedUser,
		@Body(new ZodValidationPipe(changePasswordSchema)) body: ChangePasswordDto,
		@Req() request: FastifyRequest,
		@Res({ passthrough: true }) response: FastifyReply,
	) {
		// The new password ends every session of the account...
		await this.accountService.changePassword(user.sub, body.currentPassword, body.newPassword)
		// ...and this device, which just proved it knows the password, is signed back in.
		const session = await this.sessionService.reissue(user)
		setSessionCookies(request, response, session)
		return { message: 'Senha alterada com sucesso' }
	}
}
