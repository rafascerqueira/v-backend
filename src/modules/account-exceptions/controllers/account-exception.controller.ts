import {
	BadRequestException,
	Body,
	Controller,
	Get,
	Param,
	Post,
	Query,
	Req,
	UseGuards,
} from '@nestjs/common'
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger'
import { Roles } from '@/modules/auth/decorators/roles.decorator'
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard'
import { RolesGuard } from '@/modules/auth/guards/roles.guard'
import {
	createAccountExceptionSchema,
	listAccountExceptionsSchema,
	revokeAccountExceptionSchema,
} from '../dto/account-exception.dto'
import { AccountExceptionService } from '../services/account-exception.service'

@ApiTags('admin/account-exceptions')
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AccountExceptionController {
	constructor(private readonly service: AccountExceptionService) {}

	@Get('exceptions/stats')
	@ApiOperation({
		summary: 'Get active plan_grant counts vs configured quotas (flexible — info only)',
	})
	@ApiResponse({ status: 200, description: 'Stats returned' })
	async getStats() {
		return this.service.getPlanGrantStats()
	}

	@Get('exceptions')
	@ApiOperation({ summary: 'List account exceptions across all sellers (paginated)' })
	@ApiResponse({ status: 200, description: 'Exceptions listed' })
	async list(@Query() query: unknown) {
		const parsed = listAccountExceptionsSchema.safeParse(query)
		if (!parsed.success) {
			throw new BadRequestException(parsed.error.issues[0]?.message ?? 'invalid query')
		}
		const { page, limit, ...filter } = parsed.data
		return this.service.list(filter, page, limit)
	}

	@Get('sellers/:id/exceptions')
	@ApiOperation({ summary: 'List all exceptions (active/expired/revoked) for one seller' })
	@ApiParam({ name: 'id', type: String })
	@ApiResponse({ status: 200, description: 'Exceptions listed' })
	async listForAccount(@Param('id') accountId: string) {
		return this.service.listByAccount(accountId)
	}

	@Post('sellers/:id/exceptions')
	@ApiOperation({ summary: 'Create an account exception (immutable, audited)' })
	@ApiParam({ name: 'id', type: String })
	@ApiResponse({ status: 201, description: 'Exception created' })
	async create(@Param('id') accountId: string, @Body() body: unknown, @Req() req: any) {
		const parsed = createAccountExceptionSchema.safeParse(body)
		if (!parsed.success) {
			throw new BadRequestException(parsed.error.issues[0]?.message ?? 'invalid payload')
		}
		const actorId = req.user.sub
		return this.service.create(accountId, actorId, parsed.data)
	}

	@Post('sellers/:id/exceptions/:exceptionId/revoke')
	@ApiOperation({ summary: 'Revoke an exception (captures actor + reason)' })
	@ApiParam({ name: 'id', type: String })
	@ApiParam({ name: 'exceptionId', type: String })
	@ApiResponse({ status: 200, description: 'Exception revoked' })
	async revoke(@Param('exceptionId') exceptionId: string, @Body() body: unknown, @Req() req: any) {
		const parsed = revokeAccountExceptionSchema.safeParse(body)
		if (!parsed.success) {
			throw new BadRequestException(parsed.error.issues[0]?.message ?? 'invalid payload')
		}
		const actorId = req.user.sub
		return this.service.revoke(exceptionId, actorId, parsed.data)
	}
}
