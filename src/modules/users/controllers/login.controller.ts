import {
	Body,
	Controller,
	HttpCode,
	HttpStatus,
	Post,
	Res,
	UnauthorizedException,
} from '@nestjs/common'
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import type { FastifyReply } from 'fastify'
import { AccountService } from '../services/account.service'
import { TokenService } from '@/modules/auth/services/token.service'
import { ZodValidationPipe } from '@/shared/pipes/zod-validation.pipe'
import { loginSchema, type LoginDto } from '../dto/login.dto'
import { Public } from '@/modules/auth/decorators/public.decorator'
import { AUTH_COOKIES, COOKIE_OPTIONS } from '@/modules/auth/constants/cookies'

@ApiTags('auth')
@Controller('auth')
export class LoginController {
	constructor(
		private readonly accountService: AccountService,
		private readonly tokenService: TokenService,
	) {}

	@Post('login')
	@Public()
	@HttpCode(HttpStatus.OK)
	@ApiOperation({ summary: 'User login' })
	@ApiResponse({ status: 200, description: 'Login successful, returns JWT tokens' })
	@ApiResponse({ status: 401, description: 'Invalid credentials' })
	@ApiBody({
		schema: {
			example: {
				email: 'john@example.com',
				password: 'Password123',
			},
		},
	})
	async handle(
		@Body(new ZodValidationPipe(loginSchema)) body: LoginDto,
		@Res({ passthrough: true }) response: FastifyReply,
	) {
		const { email, password } = body

		const account = await this.accountService.findByEmail(email)

		if (!account) {
			throw new UnauthorizedException('Invalid e-mail or password')
		}

		const isPasswordValid = await this.accountService.verifyPassword(
			password,
			account.password,
			account.salt,
		)

		if (!isPasswordValid) {
			throw new UnauthorizedException('Invalid e-mail or password')
		}

		// Update last login timestamp
		await this.accountService.updateLastLogin(account.id)

		const tokens = await this.tokenService.generateTokens({
			sub: account.id,
			email: account.email,
			role: account.role,
		})

		response.setCookie(AUTH_COOKIES.ACCESS_TOKEN, tokens.accessToken, {
			...COOKIE_OPTIONS,
			maxAge: tokens.expiresIn,
		})

		response.setCookie(AUTH_COOKIES.REFRESH_TOKEN, tokens.refreshToken, {
			...COOKIE_OPTIONS,
			maxAge: 7 * 24 * 60 * 60,
		})

		return tokens
	}
}
