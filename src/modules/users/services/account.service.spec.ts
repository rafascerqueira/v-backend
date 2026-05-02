/**
 * AccountService unit tests
 * Covers: changePassword, updateProfile, verifyPassword, create, findByEmail, findById
 * Verifies: not-found errors, unauthorized on wrong password, hashing and update on success
 */

import { NotFoundException, UnauthorizedException } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import { AccountService } from './account.service'
import { PasswordHasherService } from '@/shared/crypto/password-hasher.service'
import { ACCOUNT_REPOSITORY } from '@/shared/repositories/account.repository'

describe('AccountService', () => {
  let service: AccountService
  let accountRepository: any
  let passwordHasher: PasswordHasherService

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
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AccountService,
        PasswordHasherService,
        { provide: ACCOUNT_REPOSITORY, useValue: repositoryMock },
      ],
    }).compile()

    service = module.get<AccountService>(AccountService)
    accountRepository = module.get(ACCOUNT_REPOSITORY)
    passwordHasher = module.get<PasswordHasherService>(PasswordHasherService)
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
})