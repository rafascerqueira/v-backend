import { Injectable } from '@nestjs/common'
import { pbkdf2Sync, randomBytes } from 'node:crypto'
import { PrismaService } from 'src/infrastructure/prisma/prisma.service'

type CreateAccountData = {
  name: string
  email: string
  password: string
}

type HashedPasswordResult = {
  hash: string
  salt: string
}

@Injectable()
export class AccountService {
  private readonly PBKDF2_ITERATIONS = 100000
  private readonly PBKDF2_KEY_LENGTH = 64
  private readonly PBKDF2_DIGEST = 'sha256'
  private readonly SALT_BYTE_LENGTH = 16

  constructor(private prisma: PrismaService) {}

  hashPassword(password: string): HashedPasswordResult {
    const salt = randomBytes(this.SALT_BYTE_LENGTH).toString('hex')
    const saltBuffer = Buffer.from(salt, 'hex')

    const hash = pbkdf2Sync(
      password,
      saltBuffer,
      this.PBKDF2_ITERATIONS,
      this.PBKDF2_KEY_LENGTH,
      this.PBKDF2_DIGEST,
    ).toString('hex')

    return {
      hash,
      salt,
    }
  }

  verifyPassword(
    password: string,
    storedHash: string,
    storedSalt: string,
  ): boolean {
    const saltBuffer = Buffer.from(storedSalt, 'hex')

    const computeHash = pbkdf2Sync(
      password,
      saltBuffer,
      this.PBKDF2_ITERATIONS,
      this.PBKDF2_KEY_LENGTH,
      this.PBKDF2_DIGEST,
    ).toString('hex')

    return computeHash === storedHash
  }

  async create(data: CreateAccountData) {
    const { hash, salt } = this.hashPassword(data.password)

    await this.prisma.account.create({
      data: {
        name: data.name,
        email: data.email,
        password: hash,
        salt,
      },
    })
  }

  async findByEmail(email: string) {
    const user = await this.prisma.account.findUnique({
      where: {
        email,
      },
    })
    return user
  }
}
