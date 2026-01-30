import { BadRequestException, Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common'
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { ZodValidationPipe } from '@/shared/pipes/zod-validation.pipe'
import { z } from 'zod'
import { Public } from '../decorators/public.decorator'
import { EmailVerificationService } from '../services/email-verification.service'

const verifyEmailSchema = z.object({
	token: z.string().min(1),
})

const resendVerificationSchema = z.object({
	email: z.string().email(),
})

type VerifyEmailDto = z.infer<typeof verifyEmailSchema>
type ResendVerificationDto = z.infer<typeof resendVerificationSchema>

@ApiTags('auth')
@Controller('auth')
export class EmailVerificationController {
	constructor(private readonly emailVerificationService: EmailVerificationService) {}

	@Public()
	@Post('verify-email')
	@HttpCode(HttpStatus.OK)
	@ApiOperation({ summary: 'Verify email with token' })
	@ApiBody({ schema: { example: { token: 'abc123...' } } })
	@ApiResponse({ status: 200, description: 'Email verified successfully' })
	@ApiResponse({ status: 400, description: 'Invalid or expired token' })
	async verifyEmail(@Body(new ZodValidationPipe(verifyEmailSchema)) body: VerifyEmailDto) {
		const result = await this.emailVerificationService.verifyEmail(body.token)

		if (!result.success) {
			throw new BadRequestException(result.message)
		}

		return { message: result.message }
	}

	@Public()
	@Post('resend-verification')
	@HttpCode(HttpStatus.OK)
	@ApiOperation({ summary: 'Resend email verification link' })
	@ApiBody({ schema: { example: { email: 'user@example.com' } } })
	@ApiResponse({ status: 200, description: 'Verification email sent if account exists' })
	async resendVerification(
		@Body(new ZodValidationPipe(resendVerificationSchema)) body: ResendVerificationDto,
	) {
		const result = await this.emailVerificationService.resendVerification(body.email)

		if (!result.success) {
			throw new BadRequestException(result.message)
		}

		return { message: result.message }
	}
}
