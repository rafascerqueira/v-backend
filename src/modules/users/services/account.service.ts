import { Inject, Injectable, Logger } from '@nestjs/common'
import { generateUniqueSlug } from '@/shared/catalog/slug-generator'
import { PasswordHasherService } from '@/shared/crypto/password-hasher.service'
import {
	ACCOUNT_REPOSITORY,
	type AccountRepository,
	type CreateOAuthAccountData,
} from '@/shared/repositories/account.repository'

type CreateAccountInput = {
	name: string
	email: string
	password: string
}

@Injectable()
export class AccountService {
	private readonly logger = new Logger(AccountService.name)

	constructor(
		@Inject(ACCOUNT_REPOSITORY)
		private readonly accountRepository: AccountRepository,
		private readonly passwordHasher: PasswordHasherService,
	) {}

	async verifyPassword(
		password: string,
		storedHash: string | null,
		storedSalt: string | null,
	): Promise<boolean> {
		if (!storedHash || !storedSalt) return false
		return this.passwordHasher.verify(password, storedHash, storedSalt)
	}

	async create(data: CreateAccountInput) {
		const { hash, salt } = await this.passwordHasher.hash(data.password)

		const account = await this.accountRepository.create({
			name: data.name,
			email: data.email,
			password: hash,
			salt,
		})

		try {
			const slug = await generateUniqueSlug(
				(s) => this.accountRepository.existsByStoreSlug(s),
				null,
				data.name,
			)
			await this.accountRepository.updateStoreSlug(account.id, slug)
		} catch (error) {
			this.logger.warn(
				`Failed to auto-assign store slug for account ${account.id}: ${(error as Error).message}`,
			)
		}

		return account
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

	async findOrCreateOAuthAccount(data: CreateOAuthAccountData) {
		const providerField = data.googleId ? 'googleId' : 'facebookId'
		const providerId = data.googleId ?? data.facebookId

		if (providerId) {
			const byProvider =
				providerField === 'googleId'
					? await this.accountRepository.findByGoogleId(providerId)
					: await this.accountRepository.findByFacebookId(providerId)

			if (byProvider) return byProvider
		}

		const byEmail = await this.accountRepository.findByEmail(data.email)
		if (byEmail) {
			if (data.googleId) await this.accountRepository.linkGoogleId(byEmail.id, data.googleId)
			if (data.facebookId) await this.accountRepository.linkFacebookId(byEmail.id, data.facebookId)
			return byEmail
		}

		const account = await this.accountRepository.createOAuthAccount(data)

		try {
			const slug = await generateUniqueSlug(
				(s) => this.accountRepository.existsByStoreSlug(s),
				null,
				data.name,
			)
			await this.accountRepository.updateStoreSlug(account.id, slug)
		} catch (error) {
			this.logger.warn(
				`Failed to auto-assign store slug for OAuth account ${account.id}: ${(error as Error).message}`,
			)
		}

		return account
	}

	async anonymizeAccount(id: string, password: string): Promise<boolean> {
		const account = await this.accountRepository.findById(id)
		if (!account) return false

		if (!account.password || !account.salt) return false

		const isPasswordValid = await this.passwordHasher.verify(
			password,
			account.password,
			account.salt,
		)
		if (!isPasswordValid) return false

		await this.accountRepository.anonymize(id)
		return true
	}
}
