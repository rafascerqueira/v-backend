export interface VerificationTokenWithAccount {
	id: number
	account_id: string
	token: string
	expires_at: Date
	used_at: Date | null
	account: {
		email: string
		name: string
		email_verified: boolean
	}
}

export const EMAIL_VERIFICATION_REPOSITORY = Symbol('EMAIL_VERIFICATION_REPOSITORY')

export interface EmailVerificationRepository {
	deleteTokensByAccountId(accountId: string): Promise<void>
	createToken(data: { account_id: string; token: string; expires_at: Date }): Promise<void>
	findValidToken(hashedToken: string): Promise<VerificationTokenWithAccount | null>
	verifyEmailTransaction(accountId: string, tokenId: number): Promise<void>
	findAccountByEmail(email: string): Promise<{
		id: string
		email: string
		name: string
		email_verified: boolean
	} | null>
}
