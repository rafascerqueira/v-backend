import { PasswordHasherService } from './password-hasher.service'

describe('PasswordHasherService', () => {
  let service: PasswordHasherService

  beforeEach(() => {
    service = new PasswordHasherService()
  })

  describe('hash', () => {
    it('should return hash (Argon2id format)', async () => {
      const password = 'testpassword'
      const result = await service.hash(password)

      expect(result).toHaveProperty('hash')
      expect(typeof result.hash).toBe('string')
      expect(result.hash).toMatch(/^\$argon2id\$/)
    })

    it('should generate different hashes for same password', async () => {
      const password = 'testpassword'
      const result1 = await service.hash(password)
      const result2 = await service.hash(password)

      expect(result1.hash).not.toBe(result2.hash)
    })
  })

  describe('verify', () => {
    it('should verify correct password', async () => {
      const password = 'testpassword'
      const { hash, salt } = await service.hash(password)

      const isValid = await service.verify(password, hash, salt)

      expect(isValid).toBe(true)
    })

    it('should reject incorrect password', async () => {
      const password = 'testpassword'
      const wrongPassword = 'wrongpassword'
      const { hash, salt } = await service.hash(password)

      const isValid = await service.verify(wrongPassword, hash, salt)

      expect(isValid).toBe(false)
    })

    it('should reject empty password', async () => {
      const password = 'testpassword'
      const { hash, salt } = await service.hash(password)

      const isValid = await service.verify('', hash, salt)

      expect(isValid).toBe(false)
    })

    it('should handle invalid hash gracefully', async () => {
      const isValid = await service.verify('password', 'invalid-hash', '')
      expect(isValid).toBe(false)
    })
  })
})
