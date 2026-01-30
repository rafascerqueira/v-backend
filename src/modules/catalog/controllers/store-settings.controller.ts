import { Body, Controller, Get, Patch, Req, UseGuards } from '@nestjs/common'
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard'
import { ZodValidationPipe } from '@/shared/pipes/zod-validation.pipe'
import { z } from 'zod'
import { StoreSettingsService } from '../services/store-settings.service'

const updateStoreSettingsSchema = z.object({
	store_slug: z
		.string()
		.min(3)
		.max(50)
		.regex(/^[a-z0-9-]+$/, 'Slug deve conter apenas letras minúsculas, números e hífens')
		.optional(),
	store_name: z.string().min(2).max(100).optional(),
	store_description: z.string().max(500).optional(),
	store_phone: z.string().max(20).optional(),
	store_whatsapp: z.string().max(20).optional(),
})

type UpdateStoreSettingsDto = z.infer<typeof updateStoreSettingsSchema>

@ApiTags('store')
@Controller('store')
@UseGuards(JwtAuthGuard)
export class StoreSettingsController {
	constructor(private readonly service: StoreSettingsService) {}

	@Get('settings')
	@ApiOperation({ summary: 'Get current store settings' })
	@ApiResponse({ status: 200, description: 'Store settings' })
	async getSettings(@Req() req: any) {
		return this.service.getSettings(req.user.sub)
	}

	@Patch('settings')
	@ApiOperation({ summary: 'Update store settings' })
	@ApiBody({
		schema: {
			example: {
				store_slug: 'minha-loja',
				store_name: 'Minha Loja',
				store_description: 'Descrição da minha loja',
				store_phone: '11999999999',
				store_whatsapp: '11999999999',
			},
		},
	})
	@ApiResponse({ status: 200, description: 'Settings updated' })
	@ApiResponse({ status: 409, description: 'Slug already in use' })
	async updateSettings(
		@Req() req: any,
		@Body(new ZodValidationPipe(updateStoreSettingsSchema)) body: UpdateStoreSettingsDto,
	) {
		return this.service.updateSettings(req.user.sub, body)
	}

	@Get('preview-link')
	@ApiOperation({ summary: 'Get store catalog preview link' })
	@ApiResponse({ status: 200, description: 'Preview link' })
	async getPreviewLink(@Req() req: any) {
		return this.service.getPreviewLink(req.user.sub)
	}
}
