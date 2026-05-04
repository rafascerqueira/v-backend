import type { AccountExceptionStatus, AccountExceptionType } from '@/generated/prisma/client'

export interface AccountExceptionRecord {
	id: string
	account_id: string
	type: AccountExceptionType
	status: AccountExceptionStatus
	effective_from: Date
	effective_until: Date | null
	metadata: unknown
	reason: string
	created_by: string
	revoked_by: string | null
	revoked_at: Date | null
	revoke_reason: string | null
	createdAt: Date
	updatedAt: Date
}

export interface CreateAccountExceptionData {
	account_id: string
	type: AccountExceptionType
	effective_from: Date
	effective_until: Date | null
	metadata: unknown
	reason: string
	created_by: string
}

export interface RevokeAccountExceptionData {
	revoked_by: string
	revoke_reason: string
}

export interface AccountExceptionFilter {
	type?: AccountExceptionType
	status?: AccountExceptionStatus
	account_id?: string
}

export const ACCOUNT_EXCEPTION_REPOSITORY = Symbol('ACCOUNT_EXCEPTION_REPOSITORY')

export interface AccountExceptionRepository {
	create(data: CreateAccountExceptionData): Promise<AccountExceptionRecord>
	findById(id: string): Promise<AccountExceptionRecord | null>
	findActiveByAccountId(accountId: string, now: Date): Promise<AccountExceptionRecord[]>
	findByAccountId(accountId: string): Promise<AccountExceptionRecord[]>
	findMany(
		filter: AccountExceptionFilter,
		skip: number,
		limit: number,
	): Promise<{ data: AccountExceptionRecord[]; total: number }>
	revoke(id: string, data: RevokeAccountExceptionData): Promise<AccountExceptionRecord>
	countActivePlanGrants(grantedPlan: 'pro' | 'enterprise', now: Date): Promise<number>
}
