import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common'
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { ZodValidationPipe } from '@/shared/pipes/zod-validation.pipe'
import { Public } from '../decorators/public.decorator'
import { type ForgotPasswordDto, forgotPasswordSchema } from '../dto/forgot-password.dto'
import type { PasswordResetService } from '../services/password-reset.service'

@ApiTags('auth')
@Controller('auth')
export class ForgotPasswordController {
	constructor(private readonly passwordResetService: PasswordResetService) {}

	@Public()
	@Post('forgot-password')
	@HttpCode(HttpStatus.OK)
	@ApiOperation({ summary: 'Request password reset' })
	@ApiBody({ schema: { example: { email: 'user@example.com' } } })
	@ApiResponse({ status: 200, description: 'If the email exists, a reset link will be sent' })
	async forgotPassword(@Body(new ZodValidationPipe(forgotPasswordSchema)) body: ForgotPasswordDto) {
		await this.passwordResetService.createResetToken(body.email)
		return {
			message: 'Se o email estiver cadastrado, você receberá instruções para redefinir sua senha.',
		}
	}
}
