import { applyDecorators, UseGuards } from '@nestjs/common'
import { AdminGuard } from '../guards/admin.guard'

export function Admin() {
	return applyDecorators(UseGuards(AdminGuard))
}
