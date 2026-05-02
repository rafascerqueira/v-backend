import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common'
import { ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger'
import { Roles } from '@/modules/auth/decorators/roles.decorator'
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard'
import { RolesGuard } from '@/modules/auth/guards/roles.guard'
import { parseLocalDate } from '@/shared/utils/date'
import { SettingsService } from '../services/settings.service'

@ApiTags('admin/settings')
@Controller('admin/settings')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class SettingsController {
	constructor(private readonly settingsService: SettingsService) {}

	@Get()
	@ApiOperation({ summary: 'Get all system settings as flat key-value map' })
	@ApiResponse({ status: 200, description: 'All settings as a flat object' })
	async getAll() {
		const settings = await this.settingsService.getAll()
		return Object.fromEntries(
			settings.map((s) => {
				if (s.type === 'date' && s.parsed instanceof Date) {
					return [s.key, s.parsed.toISOString().split('T')[0]]
				}
				return [s.key, s.parsed]
			}),
		)
	}

	@Patch()
	@ApiOperation({ summary: 'Bulk update system settings' })
	@ApiBody({
		schema: {
			example: {
				free_trial_end_date: '2026-12-31',
				free_plan_products_limit: 50,
				free_plan_customers_limit: 100,
				free_plan_sales_limit: 30,
			},
		},
	})
	@ApiResponse({ status: 200, description: 'Settings updated' })
	async updateAll(@Body() body: Record<string, unknown>) {
		const typeMap: Record<string, 'string' | 'number' | 'boolean' | 'date' | 'json'> = {
			free_trial_end_date: 'date',
			free_plan_products_limit: 'number',
			free_plan_customers_limit: 'number',
			free_plan_sales_limit: 'number',
		}

		await Promise.all(
			Object.entries(body).map(([key, value]) => {
				const type = typeMap[key] ?? 'string'
				return this.settingsService.set(key, value, type)
			}),
		)

		return this.getAll()
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
	async setFreePeriod(@Body() body: { endDate?: string; earlyAdopterDiscount?: number }) {
		if (body.endDate) {
			await this.settingsService.setFreePeriodEndDate(parseLocalDate(body.endDate))
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
