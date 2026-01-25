import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiBody, ApiResponse } from '@nestjs/swagger'
import { Public } from '../decorators/public.decorator'
import { ZodValidationPipe } from '@/shared/pipes/zod-validation.pipe'
import { PasswordResetService } from '../services/password-reset.service'
import { forgotPasswordSchema, type ForgotPasswordDto } from '../dto/forgot-password.dto'

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
  async forgotPassword(
    @Body(new ZodValidationPipe(forgotPasswordSchema)) body: ForgotPasswordDto,
  ) {
    await this.passwordResetService.createResetToken(body.email)
    return {
      message: 'Se o email estiver cadastrado, você receberá instruções para redefinir sua senha.',
    }
  }
}
