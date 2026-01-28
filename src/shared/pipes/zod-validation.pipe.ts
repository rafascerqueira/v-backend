import { BadRequestException, type PipeTransform } from '@nestjs/common'
import type { ZodSchema } from 'zod'

export class ZodValidationPipe implements PipeTransform {
	constructor(private schema: ZodSchema) {}

	transform(value: unknown) {
		try {
			const parsedValue = this.schema.parse(value)
			return parsedValue
		} catch (error: any) {
			throw new BadRequestException({
				message: 'Validation failed',
				errors: error.errors,
			})
		}
	}
}
