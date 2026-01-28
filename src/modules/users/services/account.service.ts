import { Inject, Injectable } from '@nestjs/common'
import type { PasswordHasherService } from '@/shared/crypto/password-hasher.service'
import {
	ACCOUNT_REPOSITORY,
	type AccountRepository,
} from '@/shared/repositories/account.repository'

type CreateAccountInput = {
	name: string
	email: string
	password: string
}

@Injectable()
export class AccountService {
	constructor(
		@Inject(ACCOUNT_REPOSITORY)
		private readonly accountRepository: AccountRepository,
		private readonly passwordHasher: PasswordHasherService,
	) {}

	async verifyPassword(password: string, storedHash: string, storedSalt: string): Promise<boolean> {
		return this.passwordHasher.verify(password, storedHash, storedSalt)
	}

	async create(data: CreateAccountInput) {
		const { hash, salt } = await this.passwordHasher.hash(data.password)

		return this.accountRepository.create({
			name: data.name,
			email: data.email,
			password: hash,
			salt,
		})
	}

	async findByEmail(email: string) {
		return this.accountRepository.findByEmail(email)
	}

	async findById(id: string) {
		return this.accountRepository.findById(id)
	}

	async updateProfile(id: string, data: { name?: string }) {
		return this.accountRepository.update(id, data)
	}

	async updateLastLogin(id: string) {
		return this.accountRepository.update(id, { last_login_at: new Date() })
	}
}
