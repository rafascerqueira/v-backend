import {
	type ArgumentsHost,
	Catch,
	type ExceptionFilter,
	HttpException,
	HttpStatus,
	Logger,
} from '@nestjs/common'
import type { FastifyReply } from 'fastify'

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
	private readonly logger = new Logger(GlobalExceptionFilter.name)

	catch(exception: unknown, host: ArgumentsHost) {
		const ctx = host.switchToHttp()
		const response = ctx.getResponse<FastifyReply>()

		let status = HttpStatus.INTERNAL_SERVER_ERROR
		let message = 'Internal server error'
		let error = 'Internal Server Error'
		let details: any

		if (exception instanceof HttpException) {
			status = exception.getStatus()
			const exceptionResponse = exception.getResponse()

			if (typeof exceptionResponse === 'object') {
				message = (exceptionResponse as any).message || exception.message
				error = (exceptionResponse as any).error || exception.name
				details = (exceptionResponse as any).details
			} else {
				message = exceptionResponse
			}
		} else if (exception instanceof Error) {
			message = exception.message
			error = exception.name

			// Log unexpected errors
			this.logger.error(`Unexpected error: ${exception.message}`, exception.stack)
		}

		// Prisma errors handling
		if ((exception as any)?.code === 'P2002') {
			status = HttpStatus.CONFLICT
			message = 'Registro duplicado'
			error = 'Conflict'
		} else if ((exception as any)?.code === 'P2025') {
			status = HttpStatus.NOT_FOUND
			message = 'Registro não encontrado'
			error = 'Not Found'
		}

		const errorResponse = {
			statusCode: status,
			timestamp: new Date().toISOString(),
			path: ctx.getRequest().url,
			error,
			message,
			...(details && { details }),
		}

		response.status(status).send(errorResponse)
	}
}
