import { Controller, Get, Query } from '@nestjs/common'
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger'
import type { AuditService } from './audit.service'

@ApiTags('audit')
@Controller('audit')
export class AuditController {
	constructor(private readonly auditService: AuditService) {}

	@Get()
	@ApiOperation({ summary: 'Get recent audit logs' })
	@ApiQuery({ name: 'limit', required: false, type: Number })
	async getRecent(@Query('limit') limit?: string) {
		return this.auditService.getRecent(limit ? parseInt(limit) : 100)
	}

	@Get('entity')
	@ApiOperation({ summary: 'Get audit logs by entity' })
	@ApiQuery({ name: 'entity', required: true, type: String })
	@ApiQuery({ name: 'entityId', required: true, type: String })
	@ApiQuery({ name: 'limit', required: false, type: Number })
	async getByEntity(
		@Query('entity') entity: string,
		@Query('entityId') entityId: string,
		@Query('limit') limit?: string,
	) {
		return this.auditService.getByEntity(entity, entityId, limit ? parseInt(limit) : 50)
	}

	@Get('user')
	@ApiOperation({ summary: 'Get audit logs by user' })
	@ApiQuery({ name: 'userId', required: true, type: String })
	@ApiQuery({ name: 'limit', required: false, type: Number })
	async getByUser(@Query('userId') userId: string, @Query('limit') limit?: string) {
		return this.auditService.getByUser(userId, limit ? parseInt(limit) : 50)
	}
}
