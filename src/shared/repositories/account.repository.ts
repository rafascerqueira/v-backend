export interface Account {
	id: string
	name: string
	email: string
	password: string
	salt: string
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
	findById(id: string): Promise<Account | null>
	findByEmail(email: string): Promise<Account | null>
	update(id: string, data: UpdateAccountData): Promise<Account>
	delete(id: string): Promise<Account>
}
