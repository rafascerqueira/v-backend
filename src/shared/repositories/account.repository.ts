import type { AccountRole, PlanType } from '@/generated/prisma/client'

export interface Account {
	id: string
	name: string
	email: string
	password: string | null
	salt: string | null
	google_id: string | null
	facebook_id: string | null
	role: AccountRole
	plan_type: PlanType
	two_factor_enabled: boolean
	two_factor_secret: string | null
	last_login_at: Date | null
	createdAt: Date
	updatedAt: Date
}

export interface CreateAccountData {
	name: string
	email: string
	password: string
	salt: string
}

export interface CreateOAuthAccountData {
	name: string
	email: string
	googleId?: string
	facebookId?: string
}

export const ACCOUNT_REPOSITORY = Symbol('ACCOUNT_REPOSITORY')

export interface UpdateAccountData {
	name?: string
	email?: string
	password?: string
	salt?: string
	last_login_at?: Date
}

export interface AccountRepository {
	create(data: CreateAccountData): Promise<Account>
	createOAuthAccount(data: CreateOAuthAccountData): Promise<Account>
	findById(id: string): Promise<Account | null>
	findByEmail(email: string): Promise<Account | null>
	findByGoogleId(googleId: string): Promise<Account | null>
	findByFacebookId(facebookId: string): Promise<Account | null>
	linkGoogleId(id: string, googleId: string): Promise<void>
	linkFacebookId(id: string, facebookId: string): Promise<void>
	update(id: string, data: UpdateAccountData): Promise<Account>
	delete(id: string): Promise<Account>
	anonymize(id: string): Promise<void>
	existsByStoreSlug(slug: string): Promise<boolean>
	updateStoreSlug(id: string, slug: string): Promise<void>
}
