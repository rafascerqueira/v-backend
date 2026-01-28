import { Body, Controller, HttpCode, HttpException, HttpStatus, Post } from '@nestjs/common'
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { Public } from '@/modules/auth/decorators/public.decorator'
import { ZodValidationPipe } from '@/shared/pipes/zod-validation.pipe'
import { type CreateAccountDto, createAccountSchema } from '../dto/create-account.dto'
import { AccountService } from '../services/account.service'

@ApiTags('auth')
@Controller('auth')
export class CreateAccountController {
	constructor(private readonly accountService: AccountService) {}

	@Post('register')
	@Public()
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

		const account = await this.accountService.findByEmail(email)

		if (account) {
			throw new HttpException('Account already exists', HttpStatus.BAD_REQUEST)
		}

		await this.accountService.create({
			name,
			email,
			password,
		})
	}
}
