/**
 * AccountService unit tests
 * Covers: changePassword, updateProfile, verifyPassword, create, findByEmail, findById
 * Verifies: not-found errors, unauthorized on wrong password, hashing and update on success
 */

import { NotFoundException, UnauthorizedException } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import { PasswordHasherService } from '@/shared/crypto/password-hasher.service'
import { ACCOUNT_REPOSITORY } from '@/shared/repositories/account.repository'
import { UploadService } from '@/shared/upload/upload.service'
import { AccountService } from './account.service'

describe('AccountService', () => {
	let service: AccountService
	let accountRepository: any
	let passwordHasher: PasswordHasherService
	let uploadService: { deleteFile: jest.Mock; deleteSellerProductImages: jest.Mock }

	let accountsStore: any[]

	const createAccountRepositoryMock = () => {
		accountsStore = []
		return {
			create: jest.fn(async (data: any) => {
				const newItem = {
					id: String(accountsStore.length + 1),
					createdAt: new Date(),
					updatedAt: new Date(),
					...data,
				}
				accountsStore.push(newItem)
				return newItem
			}),
			findById: jest.fn(async (id: string) => {
				return accountsStore.find((a) => a.id === id) ?? null
			}),
			findByEmail: jest.fn(async (email: string) => {
				return accountsStore.find((a) => a.email === email) ?? null
			}),
			update: jest.fn(),
			delete: jest.fn(),
			anonymize: jest.fn(),
			existsByStoreSlug: jest.fn(async (slug: string) => {
				return accountsStore.some((a) => a.store_slug === slug)
			}),
			updateStoreSlug: jest.fn(async (id: string, slug: string) => {
				const acc = accountsStore.find((a) => a.id === id)
				if (acc) acc.store_slug = slug
			}),
		}
	}

	beforeEach(async () => {
		const repositoryMock = createAccountRepositoryMock()
		const uploadServiceMock = {
			deleteFile: jest.fn().mockResolvedValue(true),
			deleteSellerProductImages: jest.fn().mockResolvedValue(0),
		}
		const module: TestingModule = await Test.createTestingModule({
			providers: [
				AccountService,
				PasswordHasherService,
				{ provide: ACCOUNT_REPOSITORY, useValue: repositoryMock },
				{ provide: UploadService, useValue: uploadServiceMock },
			],
		}).compile()

		service = module.get<AccountService>(AccountService)
		accountRepository = module.get(ACCOUNT_REPOSITORY)
		passwordHasher = module.get<PasswordHasherService>(PasswordHasherService)
		uploadService = module.get(UploadService)
	})

	it('should be defined', () => {
		expect(service).toBeDefined()
	})

	describe('verifyPassword', () => {
		it('should verify correct password', async () => {
			const password = 'testpassword'
			const { hash, salt } = await passwordHasher.hash(password)

			const isValid = await service.verifyPassword(password, hash, salt)

			expect(isValid).toBe(true)
		})

		it('should reject incorrect password', async () => {
			const password = 'testpassword'
			const wrongPassword = 'wrongpassword'
			const { hash, salt } = await passwordHasher.hash(password)

			const isValid = await service.verifyPassword(wrongPassword, hash, salt)

			expect(isValid).toBe(false)
		})

		it('should return false when storedHash is null', async () => {
			const result = await service.verifyPassword('anyPass', null, null)
			expect(result).toBe(false)
		})
	})

	describe('create', () => {
		it('should create account with hashed password', async () => {
			const accountData = {
				name: 'John Doe',
				email: 'john@example.com',
				password: 'securepassword',
			}

			await service.create(accountData)

			const createdAccount = await accountRepository.findByEmail(accountData.email)

			expect(createdAccount).toBeTruthy()
			expect(createdAccount?.name).toBe(accountData.name)
			expect(createdAccount?.email).toBe(accountData.email)
			expect(createdAccount?.password).not.toBe(accountData.password)
			expect(createdAccount?.salt).toBeDefined()
		})

		it('should auto-assign a store slug derived from the name', async () => {
			await service.create({
				name: 'Loja da Maria',
				email: 'maria@example.com',
				password: 'Securepass1',
			})

			const created = await accountRepository.findByEmail('maria@example.com')

			expect(accountRepository.updateStoreSlug).toHaveBeenCalled()
			expect(created?.store_slug).toBe('loja-da-maria')
		})

		it('should append a numeric suffix when the base slug is already taken', async () => {
			accountsStore.push({
				id: 'pre',
				name: 'Loja da Maria',
				email: 'other@example.com',
				store_slug: 'loja-da-maria',
			})

			await service.create({
				name: 'Loja da Maria',
				email: 'maria@example.com',
				password: 'Securepass1',
			})

			const created = await accountRepository.findByEmail('maria@example.com')

			expect(created?.store_slug).toBe('loja-da-maria-2')
		})

		it('should not fail account creation when slug assignment throws', async () => {
			accountRepository.updateStoreSlug.mockRejectedValueOnce(new Error('db down'))

			const result = await service.create({
				name: 'Jane',
				email: 'jane@example.com',
				password: 'Securepass1',
			})

			expect(result).toBeTruthy()
			expect(result.email).toBe('jane@example.com')
		})
	})

	describe('findByEmail', () => {
		it('should find user by email', async () => {
			const userData = {
				name: 'John Doe',
				email: 'john@example.com',
				password: 'hashedpassword',
				salt: 'salt',
			}

			await accountRepository.create(userData)

			const result = await service.findByEmail(userData.email)

			expect(result).toBeTruthy()
			expect(result?.email).toBe(userData.email)
			expect(result?.name).toBe(userData.name)
		})

		it('should return null if user not found', async () => {
			const result = await service.findByEmail('nonexistent@example.com')
			expect(result).toBeNull()
		})
	})

	describe('findById', () => {
		it('should find user by id', async () => {
			const userData = {
				name: 'John Doe',
				email: 'john@example.com',
				password: 'hashedpassword',
				salt: 'salt',
			}

			const created = await accountRepository.create(userData)

			const result = await service.findById(created.id)

			expect(result).toBeTruthy()
			expect(result?.id).toBe(created.id)
		})
	})

	describe('changePassword', () => {
		it('should hash new password and call update when current password is valid', async () => {
			const account = {
				id: 'user-uuid-1',
				name: 'Test User',
				email: 'test@example.com',
				password: 'hashed-password',
				salt: 'stored-salt',
			}
			accountsStore.push(account)

			const originalHash = account.password
			const { hash: realHash } = await passwordHasher.hash('currentPass')
			accountsStore[0].password = realHash
			accountsStore[0].salt = ''

			accountRepository.update.mockResolvedValueOnce({ ...account, password: 'new-hash', salt: '' })

			await service.changePassword('user-uuid-1', 'currentPass', 'newPass123')

			expect(accountRepository.update).toHaveBeenCalledWith(
				'user-uuid-1',
				expect.objectContaining({ password: expect.any(String), salt: expect.any(String) }),
			)

			accountsStore[0].password = originalHash
		})

		it('should throw NotFoundException when account does not exist', async () => {
			await expect(
				service.changePassword('nonexistent-id', 'currentPass', 'newPass123'),
			).rejects.toThrow(NotFoundException)
		})

		it('should throw UnauthorizedException when current password is wrong', async () => {
			const { hash: realHash } = await passwordHasher.hash('correctPass')
			accountsStore.push({
				id: 'user-uuid-2',
				name: 'Another User',
				email: 'another@example.com',
				password: realHash,
				salt: '',
			})

			await expect(
				service.changePassword('user-uuid-2', 'wrongPass', 'newPass123'),
			).rejects.toThrow(UnauthorizedException)

			expect(accountRepository.update).not.toHaveBeenCalled()
		})
	})

	describe('setAvatar', () => {
		it('persists the storage key as the account avatar', async () => {
			accountRepository.update.mockResolvedValueOnce({
				id: 'user-1',
				avatar: 'profiles/user-1-profile.webp',
			})

			await service.setAvatar('user-1', 'profiles/user-1-profile.webp')

			expect(accountRepository.update).toHaveBeenCalledWith('user-1', {
				avatar: 'profiles/user-1-profile.webp',
			})
		})
	})

	describe('removeProfilePicture', () => {
		it('deletes the stored object (avatar is a private key) and clears the avatar', async () => {
			accountsStore.push({
				id: 'user-1',
				name: 'Pic User',
				email: 'pic@example.com',
				avatar: 'profiles/user-1-profile.webp',
			})
			accountRepository.update.mockResolvedValueOnce({ id: 'user-1', avatar: null })

			await service.removeProfilePicture('user-1')

			expect(uploadService.deleteFile).toHaveBeenCalledWith('profiles/user-1-profile.webp')
			expect(accountRepository.update).toHaveBeenCalledWith('user-1', { avatar: null })
		})

		it('clears the avatar without deleting when it is an external OAuth URL', async () => {
			accountsStore.push({
				id: 'user-2',
				name: 'OAuth User',
				email: 'oauth@example.com',
				avatar: 'https://lh3.googleusercontent.com/a/some-google-avatar',
			})
			accountRepository.update.mockResolvedValueOnce({ id: 'user-2', avatar: null })

			await service.removeProfilePicture('user-2')

			expect(uploadService.deleteFile).not.toHaveBeenCalled()
			expect(accountRepository.update).toHaveBeenCalledWith('user-2', { avatar: null })
		})

		it('clears the avatar when none is set (no-op delete)', async () => {
			accountsStore.push({ id: 'user-4', name: 'No Pic', email: 'nopic@example.com', avatar: null })
			accountRepository.update.mockResolvedValueOnce({ id: 'user-4', avatar: null })

			await service.removeProfilePicture('user-4')

			expect(uploadService.deleteFile).not.toHaveBeenCalled()
			expect(accountRepository.update).toHaveBeenCalledWith('user-4', { avatar: null })
		})

		it('throws NotFoundException when the account does not exist', async () => {
			await expect(service.removeProfilePicture('ghost')).rejects.toThrow(NotFoundException)
		})
	})

	describe('anonymizeAccount (erasure)', () => {
		it('deletes avatar + product images before anonymizing, on valid password', async () => {
			const { hash, salt } = await passwordHasher.hash('correct-pass')
			accountsStore.push({
				id: 'seller-9',
				name: 'Seller',
				email: 'seller@example.com',
				password: hash,
				salt,
				avatar: 'profiles/seller-9-profile.webp',
			})

			const ok = await service.anonymizeAccount('seller-9', 'correct-pass')

			expect(ok).toBe(true)
			expect(uploadService.deleteFile).toHaveBeenCalledWith('profiles/seller-9-profile.webp')
			expect(uploadService.deleteSellerProductImages).toHaveBeenCalledWith('seller-9')
			expect(accountRepository.anonymize).toHaveBeenCalledWith('seller-9')
		})

		it('does not touch storage or anonymize when the password is wrong', async () => {
			const { hash, salt } = await passwordHasher.hash('correct-pass')
			accountsStore.push({
				id: 'seller-10',
				name: 'Seller',
				email: 'seller10@example.com',
				password: hash,
				salt,
				avatar: 'profiles/seller-10-profile.webp',
			})

			const ok = await service.anonymizeAccount('seller-10', 'wrong-pass')

			expect(ok).toBe(false)
			expect(uploadService.deleteFile).not.toHaveBeenCalled()
			expect(uploadService.deleteSellerProductImages).not.toHaveBeenCalled()
			expect(accountRepository.anonymize).not.toHaveBeenCalled()
		})
	})
})
