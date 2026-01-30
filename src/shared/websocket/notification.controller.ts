import { Controller, Get, Param, Patch, Query, Req, UseGuards } from '@nestjs/common'
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger'
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard'
import { NotificationService } from './notification.service'

@ApiTags('notifications')
@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationController {
	constructor(private readonly notificationService: NotificationService) {}

	@Get()
	@ApiOperation({ summary: 'Get user notifications' })
	@ApiQuery({ name: 'limit', required: false, type: Number })
	@ApiResponse({ status: 200, description: 'Notifications list' })
	async getAll(@Req() req: any, @Query('limit') limit?: string) {
		return this.notificationService.getAll(req.user.sub, limit ? parseInt(limit, 10) : 50)
	}

	@Get('unread-count')
	@ApiOperation({ summary: 'Get unread notifications count' })
	@ApiResponse({ status: 200, description: 'Unread count' })
	async getUnreadCount(@Req() req: any) {
		const count = await this.notificationService.getUnreadCount(req.user.sub)
		return { count }
	}

	@Patch(':id/read')
	@ApiOperation({ summary: 'Mark notification as read' })
	@ApiResponse({ status: 200, description: 'Marked as read' })
	async markAsRead(@Req() req: any, @Param('id') id: string) {
		await this.notificationService.markAsRead(req.user.sub, id)
		return { success: true }
	}

	@Patch('read-all')
	@ApiOperation({ summary: 'Mark all notifications as read' })
	@ApiResponse({ status: 200, description: 'All marked as read' })
	async markAllAsRead(@Req() req: any) {
		await this.notificationService.markAllAsRead(req.user.sub)
		return { success: true }
	}
}
