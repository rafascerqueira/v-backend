import {
	Body,
	Controller,
	Delete,
	Get,
	HttpCode,
	HttpStatus,
	Param,
	Patch,
	Post,
	Req,
	UseGuards,
} from '@nestjs/common'
import { ApiBody, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger'
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard'
import { ZodValidationPipe } from '@/shared/pipes/zod-validation.pipe'
import { type CreateBundleDto, createBundleSchema } from '../dto/create-bundle.dto'
import { type UpdateBundleDto, updateBundleSchema } from '../dto/update-bundle.dto'
import { BundlesService } from '../services/bundles.service'

@ApiTags('bundles')
@Controller('bundles')
@UseGuards(JwtAuthGuard)
export class BundlesController {
	constructor(private readonly service: BundlesService) {}

	@Get()
	@ApiOperation({ summary: 'List all bundles' })
	findAll() {
		return this.service.findAll()
	}

	@Get(':id')
	@ApiOperation({ summary: 'Get bundle by id' })
	@ApiParam({ name: 'id', type: Number })
	findOne(@Param('id') id: string) {
		return this.service.findOne(Number(id))
	}

	@Post()
	@HttpCode(HttpStatus.CREATED)
	@ApiOperation({ summary: 'Create bundle' })
	@ApiBody({
		schema: {
			example: {
				name: 'Starter Kit',
				description: 'Bundle description',
				discount_percent: 10,
				active: true,
				items: [{ product_id: 1, quantity: 2 }],
			},
		},
	})
	create(@Body(new ZodValidationPipe(createBundleSchema)) body: CreateBundleDto, @Req() req: any) {
		return this.service.create({ ...body, seller_id: req.user.sub })
	}

	@Patch(':id')
	@ApiOperation({ summary: 'Update bundle' })
	@ApiParam({ name: 'id', type: Number })
	update(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(updateBundleSchema)) body: UpdateBundleDto,
	) {
		return this.service.update(Number(id), body)
	}

	@Delete(':id')
	@HttpCode(HttpStatus.NO_CONTENT)
	@ApiOperation({ summary: 'Delete bundle' })
	@ApiParam({ name: 'id', type: Number })
	remove(@Param('id') id: string) {
		return this.service.remove(Number(id))
	}
}
