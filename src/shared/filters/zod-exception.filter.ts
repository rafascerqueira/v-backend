import { type ArgumentsHost, Catch, type ExceptionFilter, HttpStatus } from '@nestjs/common'
import { ZodError } from 'zod'

@Catch(ZodError)
export class ZodExceptionFilter implements ExceptionFilter {
	catch(exception: ZodError, host: ArgumentsHost) {
		const ctx = host.switchToHttp()
		const response = ctx.getResponse()

		const errors = exception.issues.map((issue) => ({
			field: issue.path.join('.'),
			message: issue.message,
		}))

		response.status(HttpStatus.BAD_REQUEST).send({
			statusCode: HttpStatus.BAD_REQUEST,
			message: 'Validation failed',
			errors,
		})
	}
}
