export interface TwoFactorAccountInfo {
	email: string
	two_factor_enabled: boolean
}

export interface TwoFactorSecretInfo {
	two_factor_secret: string | null
	two_factor_enabled: boolean
}

export interface TwoFactorBackupInfo {
	two_factor_backup: unknown
	two_factor_enabled: boolean
}

export const TWO_FACTOR_REPOSITORY = Symbol('TWO_FACTOR_REPOSITORY')

export interface TwoFactorRepository {
	findAccountEmailAnd2fa(userId: string): Promise<TwoFactorAccountInfo | null>
	findAccount2faSecret(userId: string): Promise<TwoFactorSecretInfo | null>
	findAccount2faBackup(userId: string): Promise<TwoFactorBackupInfo | null>
	findAccount2faEnabled(userId: string): Promise<boolean>
	updateTwoFactorSecret(userId: string, secret: string): Promise<void>
	enableTwoFactor(userId: string): Promise<void>
	disableTwoFactor(userId: string): Promise<void>
	updateBackupCodes(userId: string, codes: string[]): Promise<void>
	findBackupCodesCount(userId: string): Promise<number>
}
