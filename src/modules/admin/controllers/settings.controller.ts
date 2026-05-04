import {
	BadRequestException,
	Body,
	Controller,
	Delete,
	Get,
	Param,
	Patch,
	Post,
	Put,
	UseGuards,
} from '@nestjs/common'
import { ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger'
import { z } from 'zod'
import { Roles } from '@/modules/auth/decorators/roles.decorator'
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard'
import { RolesGuard } from '@/modules/auth/guards/roles.guard'
import { parseLocalDate } from '@/shared/utils/date'
import { SettingsService } from '../services/settings.service'

const dateSchema = z
	.string()
	.refine((v) => !Number.isNaN(Date.parse(v)), { message: 'invalid date' })

const unlimitedPeriodSchema = z
	.object({
		startDate: dateSchema.nullable(),
		endDate: dateSchema.nullable(),
	})
	.refine((data) => (data.startDate === null) === (data.endDate === null), {
		message: 'startDate and endDate must both be set or both be null',
	})
	.refine(
		(data) =>
			data.startDate === null ||
			data.endDate === null ||
			Date.parse(data.startDate) < Date.parse(data.endDate),
		{ message: 'startDate must be before endDate' },
	)

const planGrantQuotasSchema = z.object({
	pro: z.number().int().min(0),
	enterprise: z.number().int().min(0),
})

const promotionalPeriodSchema = z
	.object({
		startDate: dateSchema.nullable(),
		endDate: dateSchema.nullable(),
		discountPercent: z.number().min(0).max(100),
	})
	.refine((data) => (data.startDate === null) === (data.endDate === null), {
		message: 'startDate and endDate must both be set or both be null',
	})
	.refine(
		(data) =>
			data.startDate === null ||
			data.endDate === null ||
			Date.parse(data.startDate) < Date.parse(data.endDate),
		{ message: 'startDate must be before endDate' },
	)

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
				free_plan_products_limit: 50,
				free_plan_customers_limit: 100,
				free_plan_sales_limit: 30,
			},
		},
	})
	@ApiResponse({ status: 200, description: 'Settings updated' })
	async updateAll(@Body() body: Record<string, unknown>) {
		const typeMap: Record<string, 'string' | 'number' | 'boolean' | 'date' | 'json'> = {
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

	@Get('plan-grant-quotas')
	@ApiOperation({
		summary: 'Get plan_grant quotas (0 = unlimited; flexible — admin still allowed to overflow)',
	})
	@ApiResponse({ status: 200, description: 'Quotas retrieved' })
	async getPlanGrantQuotas() {
		return this.settingsService.getPlanGrantQuotas()
	}

	@Put('plan-grant-quotas')
	@ApiOperation({ summary: 'Set plan_grant quotas (pro / enterprise)' })
	@ApiBody({
		schema: {
			example: { pro: 50, enterprise: 5 },
		},
	})
	@ApiResponse({ status: 200, description: 'Quotas updated' })
	async setPlanGrantQuotas(@Body() body: unknown) {
		const parsed = planGrantQuotasSchema.safeParse(body)
		if (!parsed.success) {
			throw new BadRequestException(parsed.error.issues[0]?.message ?? 'invalid payload')
		}
		await this.settingsService.setPlanGrantQuotas(parsed.data)
		return this.settingsService.getPlanGrantQuotas()
	}

	@Get('promotions')
	@ApiOperation({ summary: 'Get unlimited and promotional periods configuration' })
	@ApiResponse({ status: 200, description: 'Promotion windows retrieved' })
	async getPromotions() {
		const [unlimited, promo] = await Promise.all([
			this.settingsService.getUnlimitedPeriodWindow(),
			this.settingsService.getPromotionalPeriod(),
		])

		return {
			unlimitedPeriod: unlimited,
			promotionalPeriod: promo,
		}
	}

	@Put('promotions/unlimited-period')
	@ApiOperation({ summary: 'Set unlimited period (Window 1) start/end dates' })
	@ApiBody({
		schema: {
			example: {
				startDate: '2026-06-01',
				endDate: '2026-12-31',
			},
		},
	})
	@ApiResponse({ status: 200, description: 'Unlimited period updated' })
	async setUnlimitedPeriod(@Body() body: unknown) {
		const parsed = unlimitedPeriodSchema.safeParse(body)
		if (!parsed.success) {
			throw new BadRequestException(parsed.error.issues[0]?.message ?? 'invalid payload')
		}

		const { startDate, endDate } = parsed.data
		await this.settingsService.setUnlimitedPeriodWindow({
			startDate: startDate ? parseLocalDate(startDate.split('T')[0]) : null,
			endDate: endDate ? parseLocalDate(endDate.split('T')[0]) : null,
		})

		return this.settingsService.getUnlimitedPeriodWindow()
	}

	@Put('promotions/promotional-period')
	@ApiOperation({ summary: 'Set promotional period (Window 2) dates and discount' })
	@ApiBody({
		schema: {
			example: {
				startDate: '2026-06-01',
				endDate: '2026-09-01',
				discountPercent: 20,
			},
		},
	})
	@ApiResponse({ status: 200, description: 'Promotional period updated' })
	async setPromotionalPeriod(@Body() body: unknown) {
		const parsed = promotionalPeriodSchema.safeParse(body)
		if (!parsed.success) {
			throw new BadRequestException(parsed.error.issues[0]?.message ?? 'invalid payload')
		}

		const { startDate, endDate, discountPercent } = parsed.data
		await this.settingsService.setPromotionalPeriod({
			startDate: startDate ? parseLocalDate(startDate.split('T')[0]) : null,
			endDate: endDate ? parseLocalDate(endDate.split('T')[0]) : null,
			discountPercent,
		})

		return this.settingsService.getPromotionalPeriod()
	}

	/** @deprecated use GET /admin/settings/promotions instead */
	@Get('free-period')
	@ApiOperation({
		summary: '[DEPRECATED] Get free period configuration. Use /promotions instead.',
		deprecated: true,
	})
	@ApiResponse({ status: 200, description: 'Free period settings' })
	async getFreePeriod() {
		const [unlimited, promo] = await Promise.all([
			this.settingsService.getUnlimitedPeriodWindow(),
			this.settingsService.getPromotionalPeriod(),
		])

		return {
			endDate: unlimited.endDate,
			isActive: unlimited.isActive,
			earlyAdopterDiscount: promo.discountPercent,
		}
	}

	/** @deprecated use PUT /admin/settings/promotions/* instead */
	@Post('free-period')
	@ApiOperation({
		summary: '[DEPRECATED] Update free period end date. Use /promotions instead.',
		deprecated: true,
	})
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
			await this.settingsService.setFreePeriodEndDate(parseLocalDate(body.endDate.split('T')[0]))
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
