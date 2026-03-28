import { Body, Controller, HttpCode, HttpStatus, Post, UnauthorizedException } from '@nestjs/common'
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import { z } from 'zod'
import { AccountService } from '@/modules/users/services/account.service'
import { ZodValidationPipe } from '@/shared/pipes/zod-validation.pipe'
import { CurrentUser } from '../decorators/current-user.decorator'

const dataDeletionSchema = z.object({
	password: z.string().min(1),
	confirmation: z.literal('DELETAR MINHA CONTA'),
})

type DataDeletionDto = z.infer<typeof dataDeletionSchema>

@ApiTags('auth')
@Controller('auth')
export class DataDeletionController {
	constructor(private readonly accountService: AccountService) {}

	@Post('data-deletion')
	@Throttle({ short: { ttl: 1000, limit: 1 }, medium: { ttl: 60000, limit: 2 }, long: { ttl: 3600000, limit: 3 } })
	@HttpCode(HttpStatus.OK)
	@ApiOperation({ summary: 'LGPD — Request account data anonymization' })
	@ApiBody({
		schema: {
			example: {
				password: 'current-password',
				confirmation: 'DELETAR MINHA CONTA',
			},
		},
	})
	@ApiResponse({ status: 200, description: 'Account data anonymized successfully' })
	@ApiResponse({ status: 401, description: 'Invalid password' })
	async handle(
		@CurrentUser() user: { sub: string },
		@Body(new ZodValidationPipe(dataDeletionSchema)) body: DataDeletionDto,
	) {
		const success = await this.accountService.anonymizeAccount(user.sub, body.password)

		if (!success) {
			throw new UnauthorizedException('Senha inválida')
		}

		return {
			message: 'Seus dados foram anonimizados conforme a LGPD. Sua conta não poderá mais ser acessada.',
		}
	}
}
