import { Injectable } from '@nestjs/common'
import * as argon2 from 'argon2'

export interface HashedPassword {
	hash: string
	salt: string
}

export interface PasswordHasher {
	hash(password: string): Promise<HashedPassword>
	verify(password: string, storedHash: string, storedSalt: string): Promise<boolean>
}

@Injectable()
export class PasswordHasherService implements PasswordHasher {
	private readonly ARGON2_OPTIONS: argon2.Options = {
		type: argon2.argon2id,
		memoryCost: 65536,
		timeCost: 3,
		parallelism: 4,
	}

	async hash(password: string): Promise<HashedPassword> {
		const hash = await argon2.hash(password, this.ARGON2_OPTIONS)
		return { hash, salt: '' }
	}

	async verify(password: string, storedHash: string, _storedSalt: string): Promise<boolean> {
		try {
			return await argon2.verify(storedHash, password)
		} catch {
			return false
		}
	}
}
