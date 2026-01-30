import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common'
import { ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger'
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard'
import { Roles } from '@/modules/auth/decorators/roles.decorator'
import { RolesGuard } from '@/modules/auth/guards/roles.guard'
import { SettingsService } from '../services/settings.service'

@ApiTags('admin/settings')
@Controller('admin/settings')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class SettingsController {
	constructor(private readonly settingsService: SettingsService) {}

	@Get()
	@ApiOperation({ summary: 'Get all system settings' })
	@ApiResponse({ status: 200, description: 'List of all settings' })
	async getAll() {
		return this.settingsService.getAll()
	}

	@Get('free-period')
	@ApiOperation({ summary: 'Get free period configuration' })
	@ApiResponse({ status: 200, description: 'Free period settings' })
	async getFreePeriod() {
		const endDate = await this.settingsService.getFreePeriodEndDate()
		const isActive = await this.settingsService.isFreePeriodActive()
		const discount = await this.settingsService.getEarlyAdopterDiscount()

		return {
			endDate,
			isActive,
			earlyAdopterDiscount: discount,
		}
	}

	@Post('free-period')
	@ApiOperation({ summary: 'Update free period end date' })
	@ApiBody({
		schema: {
			example: {
				endDate: '2026-02-28T23:59:59Z',
				earlyAdopterDiscount: 20,
			},
		},
	})
	@ApiResponse({ status: 200, description: 'Free period updated' })
	async setFreePeriod(
		@Body() body: { endDate?: string; earlyAdopterDiscount?: number },
	) {
		if (body.endDate) {
			await this.settingsService.setFreePeriodEndDate(new Date(body.endDate))
		}
		if (body.earlyAdopterDiscount !== undefined) {
			await this.settingsService.setEarlyAdopterDiscount(body.earlyAdopterDiscount)
		}

		return this.getFreePeriod()
	}

	@Get(':key')
	@ApiOperation({ summary: 'Get setting by key' })
	@ApiParam({ name: 'key', type: String })
	@ApiResponse({ status: 200, description: 'Setting value' })
	async get(@Param('key') key: string) {
		return this.settingsService.get(key)
	}

	@Post(':key')
	@ApiOperation({ summary: 'Set setting value' })
	@ApiParam({ name: 'key', type: String })
	@ApiBody({
		schema: {
			example: {
				value: 'some_value',
				type: 'string',
			},
		},
	})
	@ApiResponse({ status: 200, description: 'Setting updated' })
	async set(
		@Param('key') key: string,
		@Body() body: { value: unknown; type?: 'string' | 'number' | 'boolean' | 'date' | 'json' },
	) {
		return this.settingsService.set(key, body.value, body.type || 'string')
	}

	@Delete(':key')
	@ApiOperation({ summary: 'Delete setting' })
	@ApiParam({ name: 'key', type: String })
	@ApiResponse({ status: 200, description: 'Setting deleted' })
	async delete(@Param('key') key: string) {
		const deleted = await this.settingsService.delete(key)
		return { deleted }
	}
}
