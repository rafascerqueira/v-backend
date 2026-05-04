import { Injectable } from '@nestjs/common'
import { PrismaService } from '@/shared/prisma/prisma.service'
import type {
	AccountExceptionFilter,
	AccountExceptionRecord,
	AccountExceptionRepository,
	CreateAccountExceptionData,
	RevokeAccountExceptionData,
} from '@/shared/repositories/account-exception.repository'

@Injectable()
export class PrismaAccountExceptionRepository implements AccountExceptionRepository {
	constructor(private readonly prisma: PrismaService) {}

	async create(data: CreateAccountExceptionData): Promise<AccountExceptionRecord> {
		return this.prisma.accountException.create({
			data: {
				account_id: data.account_id,
				type: data.type,
				effective_from: data.effective_from,
				effective_until: data.effective_until,
				metadata: (data.metadata ?? {}) as object,
				reason: data.reason,
				created_by: data.created_by,
			},
		}) as Promise<AccountExceptionRecord>
	}

	async findById(id: string): Promise<AccountExceptionRecord | null> {
		return this.prisma.accountException.findUnique({
			where: { id },
		}) as Promise<AccountExceptionRecord | null>
	}

	async findActiveByAccountId(accountId: string, now: Date): Promise<AccountExceptionRecord[]> {
		return this.prisma.accountException.findMany({
			where: {
				account_id: accountId,
				status: 'active',
				effective_from: { lte: now },
				OR: [{ effective_until: null }, { effective_until: { gt: now } }],
			},
			orderBy: { createdAt: 'desc' },
		}) as Promise<AccountExceptionRecord[]>
	}

	async findByAccountId(accountId: string): Promise<AccountExceptionRecord[]> {
		return this.prisma.accountException.findMany({
			where: { account_id: accountId },
			orderBy: { createdAt: 'desc' },
		}) as Promise<AccountExceptionRecord[]>
	}

	async findMany(
		filter: AccountExceptionFilter,
		skip: number,
		limit: number,
	): Promise<{ data: AccountExceptionRecord[]; total: number }> {
		const where: Record<string, unknown> = {}
		if (filter.account_id) where.account_id = filter.account_id
		if (filter.type) where.type = filter.type
		if (filter.status) where.status = filter.status

		const [data, total] = await Promise.all([
			this.prisma.accountException.findMany({
				where,
				skip,
				take: limit,
				orderBy: { createdAt: 'desc' },
			}),
			this.prisma.accountException.count({ where }),
		])

		return { data: data as AccountExceptionRecord[], total }
	}

	async countActivePlanGrants(grantedPlan: 'pro' | 'enterprise', now: Date): Promise<number> {
		return this.prisma.accountException.count({
			where: {
				type: 'plan_grant',
				status: 'active',
				effective_from: { lte: now },
				OR: [{ effective_until: null }, { effective_until: { gt: now } }],
				metadata: { path: ['grantedPlan'], equals: grantedPlan },
			},
		})
	}

	async revoke(id: string, data: RevokeAccountExceptionData): Promise<AccountExceptionRecord> {
		return this.prisma.accountException.update({
			where: { id },
			data: {
				status: 'revoked',
				revoked_by: data.revoked_by,
				revoked_at: new Date(),
				revoke_reason: data.revoke_reason,
			},
		}) as Promise<AccountExceptionRecord>
	}
}
