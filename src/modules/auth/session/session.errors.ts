import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common'

/** Machine-readable reasons a session is refused. The SPA branches on these. */
export const SESSION_ERROR_CODE = {
	/** No usable session: token missing, invalid or expired, or the session timed out. */
	EXPIRED: 'SESSION_EXPIRED',
	/** The session was ended on purpose (password change, sign-out everywhere, reuse). */
	REVOKED: 'SESSION_REVOKED',
	/** The account was deactivated. */
	ACCOUNT_INACTIVE: 'ACCOUNT_INACTIVE',
} as const

export type SessionErrorCode = (typeof SESSION_ERROR_CODE)[keyof typeof SESSION_ERROR_CODE]

const MESSAGES: Record<SessionErrorCode, string> = {
	SESSION_EXPIRED: 'Sua sessão expirou. Entre novamente.',
	SESSION_REVOKED: 'Sua sessão foi encerrada. Entre novamente.',
	ACCOUNT_INACTIVE: 'Conta desativada. Entre em contato com o suporte.',
}

/** 401 carrying one of the session codes; the same shape on every authenticated route. */
export class SessionException extends UnauthorizedException {
	readonly code: SessionErrorCode

	constructor(code: SessionErrorCode) {
		super({ statusCode: 401, error: 'Unauthorized', message: MESSAGES[code], code })
		this.code = code
	}
}

/**
 * The session store (Redis) could not be reached. Authentication fails closed: the
 * request is refused with 503, never let through.
 */
export class SessionStoreUnavailableException extends ServiceUnavailableException {
	constructor() {
		super({
			statusCode: 503,
			error: 'Service Unavailable',
			message: 'Serviço temporariamente indisponível. Tente novamente em instantes.',
			code: 'SESSION_STORE_UNAVAILABLE',
		})
	}
}
