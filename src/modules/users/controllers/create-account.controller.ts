import { Body, Controller, HttpCode, HttpException, HttpStatus, Post } from '@nestjs/common'
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import { Public } from '@/modules/auth/decorators/public.decorator'
import { EmailVerificationService } from '@/modules/auth/services/email-verification.service'
import { ZodValidationPipe } from '@/shared/pipes/zod-validation.pipe'
import { type CreateAccountDto, createAccountSchema } from '../dto/create-account.dto'
import { AccountService } from '../services/account.service'

@ApiTags('auth')
@Controller('auth')
export class CreateAccountController {
	constructor(
		private readonly accountService: AccountService,
		private readonly emailVerificationService: EmailVerificationService,
	) {}

	@Post('register')
	@Public()
	@Throttle({ short: { ttl: 1000, limit: 1 }, medium: { ttl: 60000, limit: 3 }, long: { ttl: 3600000, limit: 10 } })
	@HttpCode(HttpStatus.CREATED)
	@ApiOperation({ summary: 'Create user account' })
	@ApiResponse({ status: 201, description: 'Account created successfully' })
	@ApiResponse({ status: 400, description: 'Account already exists or validation error' })
	@ApiBody({
		schema: {
			example: {
				name: 'John Doe',
				email: 'john@example.com',
				password: 'Password123',
			},
		},
	})
	async handle(@Body(new ZodValidationPipe(createAccountSchema)) body: CreateAccountDto) {
		const { name, email, password } = body

		const existingAccount = await this.accountService.findByEmail(email)

		if (existingAccount) {
			throw new HttpException('Account already exists', HttpStatus.BAD_REQUEST)
		}

		let account: any
		try {
			account = await this.accountService.create({
				name,
				email,
				password,
			})
		} catch (error: any) {
			// Handle race condition: concurrent requests with same email
			if (error?.code === 'P2002') {
				throw new HttpException('Account already exists', HttpStatus.BAD_REQUEST)
			}
			throw error
		}

		await this.emailVerificationService.createVerificationToken(account.id, email, name)

		return { message: 'Conta criada! Verifique seu email para ativar.' }
	}
}
