export interface ResetTokenRecord {
	id: number
	account_id: string
	token: string
	expires_at: Date
	used_at: Date | null
}

export const PASSWORD_RESET_REPOSITORY = Symbol('PASSWORD_RESET_REPOSITORY')

export interface PasswordResetRepository {
	deleteTokensByAccountId(accountId: string): Promise<void>
	createToken(data: { account_id: string; token: string; expires_at: Date }): Promise<void>
	findValidToken(hashedToken: string): Promise<ResetTokenRecord | null>
	resetPasswordTransaction(
		accountId: string,
		tokenId: number,
		hashedPassword: string,
		salt: string,
	): Promise<void>
}
