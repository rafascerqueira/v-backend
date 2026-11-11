import type { AccountRole, PlanType } from '@/generated/prisma/client'

/**
 * What a session token carries. Deliberately no role, plan or e-mail: those are read
 * from the account on every request, so a change takes effect without a new login.
 */
export interface SessionTokenClaims {
	/** Account id. */
	sub: string
	/** Session id: one per login. */
	sid: string
	/** The account's `session_version` when the token was issued. */
	sv: number
	/** Token id. For a refresh token it is the rotation counter the session expects. */
	jti: string
	type: 'access' | 'refresh'
	iat?: number
	exp?: number
}

/**
 * `request.user`: the authenticated account as of this request. `role`, `plan_type`
 * and `email` come from the account, not from the token.
 */
export interface AuthenticatedUser {
	sub: string
	email: string
	role: AccountRole
	plan_type: PlanType
	/** The session this request is authenticated by. */
	sid: string
}

/** Tokens and lifetimes to write into the session cookies. */
export interface IssuedSession {
	accessToken: string
	/** Absent when a concurrent refresh already rotated the token (grace window). */
	refreshToken?: string
	/** Access-token lifetime in seconds. */
	expiresIn: number
	/** "Keep me signed in": cookies outlive the browser session. */
	persistent: boolean
	/** Seconds until the session ends if it is not used again. */
	sessionTtl: number
}
