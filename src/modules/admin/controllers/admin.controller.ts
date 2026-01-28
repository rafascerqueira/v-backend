import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common'
import { ApiBody, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger'
import type { PlanType } from '@/generated/prisma/client'
import { Roles } from '@/modules/auth/decorators/roles.decorator'
import { RolesGuard } from '@/modules/auth/guards/roles.guard'
import type { AdminService } from '../services/admin.service'

@ApiTags('admin')
@Controller('admin')
@UseGuards(RolesGuard)
@Roles('admin')
export class AdminController {
	constructor(private readonly service: AdminService) {}

	@Get('stats')
	@ApiOperation({ summary: 'Get system statistics (admin only)' })
	@ApiResponse({ status: 200, description: 'Statistics retrieved successfully' })
	@ApiResponse({ status: 403, description: 'Forbidden - Admin only' })
	async getStats() {
		return this.service.getStats()
	}

	@Get('subscription-stats')
	@ApiOperation({ summary: 'Get subscription statistics (admin only)' })
	@ApiResponse({ status: 200, description: 'Subscription stats retrieved' })
	async getSubscriptionStats() {
		return this.service.getSubscriptionStats()
	}

	@Get('accounts')
	@ApiOperation({ summary: 'List all accounts (admin only)' })
	@ApiQuery({ name: 'page', required: false, type: Number })
	@ApiQuery({ name: 'limit', required: false, type: Number })
	@ApiQuery({ name: 'role', required: false, type: String })
	@ApiQuery({ name: 'plan', required: false, type: String })
	@ApiQuery({ name: 'search', required: false, type: String })
	@ApiResponse({ status: 200, description: 'Accounts listed successfully' })
	async getAccounts(
		@Query('page') page?: string,
		@Query('limit') limit?: string,
		@Query('role') role?: string,
		@Query('plan') plan?: string,
		@Query('search') search?: string,
	) {
		return this.service.getAccounts(
			page ? parseInt(page, 10) : 1,
			limit ? parseInt(limit, 10) : 20,
			{ role, plan, search },
		)
	}

	@Get('accounts/:id')
	@ApiOperation({ summary: 'Get account details (admin only)' })
	@ApiParam({ name: 'id', type: String })
	@ApiResponse({ status: 200, description: 'Account details retrieved' })
	@ApiResponse({ status: 404, description: 'Account not found' })
	async getAccountById(@Param('id') id: string) {
		return this.service.getAccountById(id)
	}

	@Get('accounts/:id/usage')
	@ApiOperation({ summary: 'Get account usage details (admin only)' })
	@ApiParam({ name: 'id', type: String })
	@ApiResponse({ status: 200, description: 'Account usage retrieved' })
	async getAccountUsage(@Param('id') id: string) {
		return this.service.getAccountUsage(id)
	}

	@Patch('accounts/:id/plan')
	@ApiOperation({ summary: 'Update account plan (admin only)' })
	@ApiParam({ name: 'id', type: String })
	@ApiBody({ schema: { example: { plan: 'pro' } } })
	@ApiResponse({ status: 200, description: 'Plan updated successfully' })
	@ApiResponse({ status: 404, description: 'Account not found' })
	@ApiResponse({ status: 400, description: 'Invalid operation' })
	async updateAccountPlan(@Param('id') id: string, @Body('plan') plan: PlanType, @Req() req: any) {
		return this.service.updateAccountPlan(id, plan, req.user.sub)
	}

	@Post('accounts/:id/suspend')
	@ApiOperation({ summary: 'Suspend account (admin only)' })
	@ApiParam({ name: 'id', type: String })
	@ApiBody({ schema: { example: { reason: 'Violação dos termos de uso' } } })
	@ApiResponse({ status: 200, description: 'Account suspended' })
	async suspendAccount(@Param('id') id: string, @Body('reason') reason: string, @Req() req: any) {
		return this.service.suspendAccount(id, reason, req.user.sub)
	}

	@Post('accounts/:id/reset-password')
	@ApiOperation({ summary: 'Generate password reset token (admin only)' })
	@ApiParam({ name: 'id', type: String })
	@ApiResponse({ status: 200, description: 'Reset token generated' })
	async resetUserPassword(@Param('id') id: string, @Req() req: any) {
		return this.service.resetUserPassword(id, req.user.sub)
	}

	@Post('accounts/:id/disable-2fa')
	@ApiOperation({ summary: 'Disable 2FA for account (admin only)' })
	@ApiParam({ name: 'id', type: String })
	@ApiResponse({ status: 200, description: '2FA disabled' })
	async disable2FA(@Param('id') id: string, @Req() req: any) {
		return this.service.disable2FA(id, req.user.sub)
	}

	@Get('active-users')
	@ApiOperation({ summary: 'Get currently active users (admin only)' })
	@ApiResponse({ status: 200, description: 'Active users retrieved successfully' })
	async getActiveUsers() {
		return this.service.getActiveUsers()
	}

	@Get('logs')
	@ApiOperation({ summary: 'Get audit logs (admin only)' })
	@ApiQuery({ name: 'page', required: false, type: Number })
	@ApiQuery({ name: 'limit', required: false, type: Number })
	@ApiQuery({ name: 'entity', required: false, type: String })
	@ApiQuery({ name: 'action', required: false, type: String })
	@ApiResponse({ status: 200, description: 'Logs retrieved successfully' })
	async getLogs(
		@Query('page') page?: string,
		@Query('limit') limit?: string,
		@Query('entity') entity?: string,
		@Query('action') action?: string,
	) {
		return this.service.getAuditLogs(
			page ? parseInt(page, 10) : 1,
			limit ? parseInt(limit, 10) : 50,
			{ entity, action },
		)
	}

	@Get('health')
	@ApiOperation({ summary: 'Check system health (admin only)' })
	@ApiResponse({ status: 200, description: 'System health status' })
	async getHealth() {
		return this.service.getSystemHealth()
	}
}
