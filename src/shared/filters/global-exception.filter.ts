import {
	type ArgumentsHost,
	Catch,
	type ExceptionFilter,
	HttpException,
	HttpStatus,
	Logger,
} from '@nestjs/common'
import type { FastifyReply } from 'fastify'

/**
 * Client-facing error codes are SCREAMING_SNAKE_CASE identifiers (e.g.
 * SUBSCRIPTION_EXISTS). Anything else is dropped, so free text or internal details put
 * in `code` by mistake never reach the client.
 */
const ERROR_CODE_FORMAT = /^[A-Z][A-Z0-9_]{1,63}$/

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
		// Optional machine-readable reason the client can branch on (e.g. 409
		// SUBSCRIPTION_EXISTS vs CHECKOUT_IN_PROGRESS). Only sent when an exception sets it.
		let code: string | undefined

		if (exception instanceof HttpException) {
			status = exception.getStatus()
			const exceptionResponse = exception.getResponse()

			if (typeof exceptionResponse === 'object') {
				message = (exceptionResponse as any).message || exception.message
				error = (exceptionResponse as any).error || exception.name
				details = (exceptionResponse as any).details
				const rawCode = (exceptionResponse as any).code
				if (typeof rawCode === 'string' && ERROR_CODE_FORMAT.test(rawCode)) code = rawCode
			} else {
				message = exceptionResponse
			}
		} else if (exception instanceof Error) {
			// Log the real error server-side, but don't leak internals to clients in production.
			this.logger.error(`Unexpected error: ${exception.message}`, exception.stack)

			if (process.env.NODE_ENV === 'production') {
				message = 'Internal server error'
				error = 'Internal Server Error'
			} else {
				message = exception.message
				error = exception.name
			}
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
		} else if ((exception as any)?.code === 'P2003') {
			// Foreign-key violation, e.g. deleting something whose payment history must
			// be kept (the ledger FK backs the app-level HAS_PAYMENTS checks).
			status = HttpStatus.CONFLICT
			message = 'Não é possível concluir: existem registros vinculados a este item.'
			error = 'Conflict'
		}

		const errorResponse = {
			statusCode: status,
			timestamp: new Date().toISOString(),
			path: ctx.getRequest().url,
			error,
			message,
			...(code && { code }),
			...(details && { details }),
		}

		response.status(status).send(errorResponse)
	}
}
