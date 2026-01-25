import { Controller, Post, Body, HttpCode, HttpStatus, BadRequestException } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiBody, ApiResponse } from '@nestjs/swagger'
import { Public } from '../decorators/public.decorator'
import { ZodValidationPipe } from '@/shared/pipes/zod-validation.pipe'
import { PasswordResetService } from '../services/password-reset.service'
import { resetPasswordSchema, type ResetPasswordDto } from '../dto/forgot-password.dto'

@ApiTags('auth')
@Controller('auth')
export class ResetPasswordController {
  constructor(private readonly passwordResetService: PasswordResetService) {}

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset password with token' })
  @ApiBody({ schema: { example: { token: 'abc123', password: 'newpassword' } } })
  @ApiResponse({ status: 200, description: 'Password reset successful' })
  @ApiResponse({ status: 400, description: 'Invalid or expired token' })
  async resetPassword(
    @Body(new ZodValidationPipe(resetPasswordSchema)) body: ResetPasswordDto,
  ) {
    const success = await this.passwordResetService.resetPassword(body.token, body.password)
    
    if (!success) {
      throw new BadRequestException('Token inválido ou expirado')
    }
    
    return { message: 'Senha redefinida com sucesso!' }
  }
}
