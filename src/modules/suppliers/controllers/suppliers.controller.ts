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
import {
	type CreateDebtDto,
	createDebtSchema,
	type PayDebtDto,
	payDebtSchema,
} from '../dto/create-debt.dto'
import { type CreateSupplierDto, createSupplierSchema } from '../dto/create-supplier.dto'
import { SuppliersService } from '../services/suppliers.service'

@ApiTags('suppliers')
@Controller('suppliers')
@UseGuards(JwtAuthGuard)
export class SuppliersController {
	constructor(private readonly service: SuppliersService) {}

	@Get()
	@ApiOperation({ summary: 'List all suppliers' })
	findAll() {
		return this.service.findAll()
	}

	@Post()
	@HttpCode(HttpStatus.CREATED)
	@ApiOperation({ summary: 'Create supplier' })
	create(
		@Body(new ZodValidationPipe(createSupplierSchema)) body: CreateSupplierDto,
		@Req() req: any,
	) {
		return this.service.create({ ...body, seller_id: req.user.sub })
	}

	@Patch(':id')
	@ApiOperation({ summary: 'Update supplier' })
	@ApiParam({ name: 'id' })
	update(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(createSupplierSchema.partial())) body: Partial<CreateSupplierDto>,
	) {
		return this.service.update(id, body)
	}

	@Delete(':id')
	@HttpCode(HttpStatus.NO_CONTENT)
	@ApiOperation({ summary: 'Delete supplier' })
	@ApiParam({ name: 'id' })
	remove(@Param('id') id: string) {
		return this.service.remove(id)
	}

	@Get(':id/debts')
	@ApiOperation({ summary: 'List debts for a supplier' })
	@ApiParam({ name: 'id' })
	findDebts(@Param('id') id: string) {
		return this.service.findDebts(id)
	}

	@Post(':id/debts')
	@HttpCode(HttpStatus.CREATED)
	@ApiOperation({ summary: 'Register a debt for a supplier' })
	@ApiParam({ name: 'id' })
	createDebt(
		@Param('id') id: string,
		@Body(new ZodValidationPipe(createDebtSchema)) body: CreateDebtDto,
	) {
		return this.service.createDebt(id, body)
	}

	@Post('debts/:debtId/pay')
	@HttpCode(HttpStatus.OK)
	@ApiOperation({ summary: 'Register a payment for a debt' })
	@ApiParam({ name: 'debtId', type: Number })
	@ApiBody({ schema: { example: { amount: 5000 } } })
	payDebt(
		@Param('debtId') debtId: string,
		@Body(new ZodValidationPipe(payDebtSchema)) body: PayDebtDto,
	) {
		return this.service.payDebt(Number(debtId), body)
	}
}
