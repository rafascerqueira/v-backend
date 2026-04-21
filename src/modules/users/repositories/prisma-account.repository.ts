import { randomBytes } from 'node:crypto'
import { Injectable } from '@nestjs/common'
import { PrismaService } from '@/shared/prisma/prisma.service'
import type {
	Account,
	AccountRepository,
	CreateAccountData,
} from '@/shared/repositories/account.repository'

@Injectable()
export class PrismaAccountRepository implements AccountRepository {
	constructor(private readonly prisma: PrismaService) {}

	async create(data: CreateAccountData): Promise<Account> {
		return this.prisma.account.create({ data })
	}

	async findById(id: string): Promise<Account | null> {
		return this.prisma.account.findUnique({ where: { id } })
	}

	async findByEmail(email: string): Promise<Account | null> {
		return this.prisma.account.findUnique({ where: { email } })
	}

	async update(id: string, data: Partial<CreateAccountData>): Promise<Account> {
		return this.prisma.account.update({ where: { id }, data })
	}

	async delete(id: string): Promise<Account> {
		return this.prisma.account.delete({ where: { id } })
	}

	async existsByStoreSlug(slug: string): Promise<boolean> {
		const found = await this.prisma.account.findFirst({
			where: { store_slug: slug },
			select: { id: true },
		})
		return !!found
	}

	async updateStoreSlug(id: string, slug: string): Promise<void> {
		await this.prisma.account.update({
			where: { id },
			data: { store_slug: slug },
		})
	}

	async anonymize(id: string): Promise<void> {
		const anonymousId = randomBytes(8).toString('hex')
		const anonymousEmail = `deleted-${anonymousId}@anonymized.local`

		await this.prisma.$transaction(async (tx) => {
			// 1. Anonymize account PII
			await tx.account.update({
				where: { id },
				data: {
					name: 'Usuário Removido',
					email: anonymousEmail,
					password: 'ANONYMIZED',
					salt: 'ANONYMIZED',
					email_verified: false,
					two_factor_enabled: false,
					two_factor_secret: null,
					two_factor_backup: [],
					store_slug: null,
					store_name: null,
					store_description: null,
					store_logo: null,
					store_banner: null,
					store_phone: null,
					store_whatsapp: null,
				},
			})

			// 2. Anonymize customer PII (keep records for financial history)
			const customers = await tx.customer.findMany({
				where: { seller_id: id },
				select: { id: true },
			})

			for (const customer of customers) {
				const custAnonId = randomBytes(4).toString('hex')
				await tx.customer.update({
					where: { id: customer.id },
					data: {
						name: `Cliente Anonimizado ${custAnonId}`,
						email: null,
						phone: `0000${custAnonId}`,
						document: null,
						address: {},
						city: 'N/A',
						state: 'NA',
						zip_code: null,
						active: false,
					},
				})
			}

			// 3. Delete auth tokens
			await tx.password_reset_token.deleteMany({ where: { account_id: id } })
			await tx.email_verification_token.deleteMany({ where: { account_id: id } })

			// 4. Delete notifications
			await tx.notification.deleteMany({ where: { user_id: id } })
		})
	}
}
