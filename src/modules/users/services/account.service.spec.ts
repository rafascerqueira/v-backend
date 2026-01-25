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
})