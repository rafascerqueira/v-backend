import { Inject, Injectable, NotFoundException } from '@nestjs/common'
import { SettingsService } from '@/modules/admin/services/settings.service'
import {
	ACCOUNT_EXCEPTION_REPOSITORY,
	type AccountExceptionFilter,
	type AccountExceptionRecord,
	type AccountExceptionRepository,
} from '@/shared/repositories/account-exception.repository'
import type {
	CreateAccountExceptionInput,
	RevokeAccountExceptionInput,
} from '../dto/account-exception.dto'

export interface PlanGrantStat {
	active: number
	quota: number
	exceeded: boolean
}

export interface PlanGrantStats {
	pro: PlanGrantStat
	enterprise: PlanGrantStat
}

export interface ResolvedExceptions {
	unlimitedWindow: AccountExceptionRecord | null
	planGrant: { record: AccountExceptionRecord; grantedPlan: 'pro' | 'enterprise' } | null
	customLimits: {
		record: AccountExceptionRecord
		maxProducts?: number
		maxCustomers?: number
		maxOrdersPerMonth?: number
	} | null
	billingAdjustment: {
		record: AccountExceptionRecord
		nextBillingDate: Date
	} | null
}

@Injectable()
export class AccountExceptionService {
	constructor(
		@Inject(ACCOUNT_EXCEPTION_REPOSITORY)
		private readonly repository: AccountExceptionRepository,
		private readonly settingsService: SettingsService,
	) {}

	async getPlanGrantStats(now: Date = new Date()): Promise<PlanGrantStats> {
		const [proCount, enterpriseCount, quotas] = await Promise.all([
			this.repository.countActivePlanGrants('pro', now),
			this.repository.countActivePlanGrants('enterprise', now),
			this.settingsService.getPlanGrantQuotas(),
		])
		return {
			pro: {
				active: proCount,
				quota: quotas.pro,
				exceeded: quotas.pro > 0 && proCount >= quotas.pro,
			},
			enterprise: {
				active: enterpriseCount,
				quota: quotas.enterprise,
				exceeded: quotas.enterprise > 0 && enterpriseCount >= quotas.enterprise,
			},
		}
	}

	async create(
		accountId: string,
		actorId: string,
		input: CreateAccountExceptionInput,
	): Promise<AccountExceptionRecord> {
		return this.repository.create({
			account_id: accountId,
			type: input.type,
			effective_from: new Date(input.effectiveFrom),
			effective_until: input.effectiveUntil ? new Date(input.effectiveUntil) : null,
			metadata: input.metadata ?? {},
			reason: input.reason,
			created_by: actorId,
		})
	}

	async revoke(
		exceptionId: string,
		actorId: string,
		input: RevokeAccountExceptionInput,
	): Promise<AccountExceptionRecord> {
		const existing = await this.repository.findById(exceptionId)
		if (!existing) throw new NotFoundException('Exceção não encontrada')
		if (existing.status !== 'active') {
			throw new NotFoundException('Exceção já revogada ou expirada')
		}
		return this.repository.revoke(exceptionId, {
			revoked_by: actorId,
			revoke_reason: input.reason,
		})
	}

	async listByAccount(accountId: string): Promise<AccountExceptionRecord[]> {
		return this.repository.findByAccountId(accountId)
	}

	async list(
		filter: AccountExceptionFilter,
		page: number,
		limit: number,
	): Promise<{ data: AccountExceptionRecord[]; total: number; page: number; limit: number }> {
		const skip = (page - 1) * limit
		const result = await this.repository.findMany(filter, skip, limit)
		return { ...result, page, limit }
	}

	async resolveActiveExceptions(
		accountId: string,
		now: Date = new Date(),
	): Promise<ResolvedExceptions> {
		const records = await this.repository.findActiveByAccountId(accountId, now)

		let unlimitedWindow: AccountExceptionRecord | null = null
		let planGrant: ResolvedExceptions['planGrant'] = null
		let customLimits: ResolvedExceptions['customLimits'] = null
		let billingAdjustment: ResolvedExceptions['billingAdjustment'] = null

		for (const record of records) {
			const meta = (record.metadata ?? {}) as Record<string, unknown>
			switch (record.type) {
				case 'unlimited_window':
					if (!unlimitedWindow) unlimitedWindow = record
					break
				case 'plan_grant': {
					const granted = meta.grantedPlan
					if (!planGrant && (granted === 'pro' || granted === 'enterprise')) {
						planGrant = { record, grantedPlan: granted }
					}
					break
				}
				case 'custom_limits':
					if (!customLimits) {
						customLimits = {
							record,
							maxProducts: typeof meta.maxProducts === 'number' ? meta.maxProducts : undefined,
							maxCustomers: typeof meta.maxCustomers === 'number' ? meta.maxCustomers : undefined,
							maxOrdersPerMonth:
								typeof meta.maxOrdersPerMonth === 'number' ? meta.maxOrdersPerMonth : undefined,
						}
					}
					break
				case 'billing_adjustment':
					if (!billingAdjustment && typeof meta.nextBillingDate === 'string') {
						billingAdjustment = {
							record,
							nextBillingDate: new Date(meta.nextBillingDate),
						}
					}
					break
			}
		}

		return { unlimitedWindow, planGrant, customLimits, billingAdjustment }
	}
}
