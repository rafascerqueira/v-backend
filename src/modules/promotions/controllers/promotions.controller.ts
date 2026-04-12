import {
	Body,
	Controller,
	Get,
	HttpCode,
	HttpStatus,
	Param,
	Patch,
	Post,
	Req,
	UseGuards,
} from '@nestjs/common'
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger'
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard'
import { ZodValidationPipe } from '@/shared/pipes/zod-validation.pipe'
import { type CreatePromotionDto, createPromotionSchema } from '../dto/create-promotion.dto'
import { PromotionsService } from '../services/promotions.service'

@ApiTags('promotions')
@Controller('promotions')
@UseGuards(JwtAuthGuard)
export class PromotionsController {
	constructor(private readonly service: PromotionsService) {}

	@Get()
	@ApiOperation({ summary: 'List all promotions' })
	findAll() {
		return this.service.findAll()
	}

	@Post()
	@HttpCode(HttpStatus.CREATED)
	@ApiOperation({ summary: 'Create promotion' })
	create(
		@Body(new ZodValidationPipe(createPromotionSchema)) body: CreatePromotionDto,
		@Req() req: any,
	) {
		return this.service.create({ ...body, seller_id: req.user.sub })
	}

	@Patch(':id/end')
	@ApiOperation({ summary: 'End a promotion' })
	@ApiParam({ name: 'id', type: Number })
	end(@Param('id') id: string) {
		return this.service.end(Number(id))
	}
}
