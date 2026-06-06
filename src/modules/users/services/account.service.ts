import {
	Inject,
	Injectable,
	Logger,
	NotFoundException,
	UnauthorizedException,
} from '@nestjs/common'
import { generateUniqueSlug } from '@/shared/catalog/slug-generator'
import { PasswordHasherService } from '@/shared/crypto/password-hasher.service'
import {
	ACCOUNT_REPOSITORY,
	type AccountRepository,
	type CreateOAuthAccountData,
	type UpdateAccountData,
} from '@/shared/repositories/account.repository'
import { UploadService } from '@/shared/upload/upload.service'

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
		private readonly uploadService: UploadService,
	) {}

	async verifyPassword(
		password: string,
		storedHash: string | null,
		storedSalt: string | null,
	): Promise<boolean> {
		if (!storedHash) return false
		return this.passwordHasher.verify(password, storedHash, storedSalt ?? '')
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

	async updateProfile(id: string, data: UpdateAccountData) {
		return this.accountRepository.update(id, data)
	}

	/** Persist the private storage key for a freshly uploaded avatar. */
	async setAvatar(id: string, key: string) {
		return this.accountRepository.update(id, { avatar: key })
	}

	async removeProfilePicture(id: string) {
		const account = await this.accountRepository.findById(id)
		if (!account) throw new NotFoundException('User not found')

		// Uploaded avatars are private storage keys we own; external (OAuth) avatars
		// are absolute URLs we never wrote — only delete the former.
		if (account.avatar && !/^https?:\/\//.test(account.avatar)) {
			await this.uploadService.deleteFile(account.avatar)
		}

		return this.accountRepository.update(id, { avatar: null })
	}

	async changePassword(id: string, currentPassword: string, newPassword: string): Promise<void> {
		const account = await this.accountRepository.findById(id)
		if (!account) throw new NotFoundException('User not found')

		const isValid = await this.verifyPassword(currentPassword, account.password, account.salt)
		if (!isValid) throw new UnauthorizedException('Senha atual incorreta')

		const { hash, salt } = await this.passwordHasher.hash(newPassword)
		await this.accountRepository.update(id, { password: hash, salt })
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
			// Facebook does not guarantee the email is verified, so auto-linking it onto an
			// existing password-based account would allow account takeover. Refuse and require
			// the user to sign in with their password and link the provider explicitly.
			if (data.facebookId && byEmail.password) {
				throw new UnauthorizedException(
					'Já existe uma conta com este email. Faça login com sua senha para vincular o Facebook.',
				)
			}
			// Google verifies email ownership (checked in the OAuth callback), so linking is safe.
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

		// Password-based accounts only. The argon2 salt is embedded in the encoded
		// hash, so `salt` is an empty string by design — do NOT gate on it (doing so
		// rejected every deletion). verify() ignores the salt argument.
		if (!account.password) return false

		const isPasswordValid = await this.passwordHasher.verify(
			password,
			account.password,
			account.salt ?? '',
		)
		if (!isPasswordValid) return false

		// Right to erasure: remove stored media before anonymizing the record.
		// Storage cleanup must never block the legal erasure of the DB record, so
		// failures are logged, not thrown.
		try {
			if (account.avatar && !/^https?:\/\//.test(account.avatar)) {
				await this.uploadService.deleteFile(account.avatar)
			}
			await this.uploadService.deleteSellerProductImages(id)
		} catch (error) {
			this.logger.error(`Failed to erase stored media for account ${id}`, error)
		}

		await this.accountRepository.anonymize(id)
		return true
	}
}
