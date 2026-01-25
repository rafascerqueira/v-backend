import { AsyncLocalStorage } from 'node:async_hooks'
import { Injectable } from '@nestjs/common'

export interface TenantData {
	sellerId: string
	role: string
}

const tenantStorage = new AsyncLocalStorage<TenantData>()

@Injectable()
export class TenantContext {
	run<T>(tenant: TenantData, fn: () => T): T {
		return tenantStorage.run(tenant, fn)
	}

	get(): TenantData | undefined {
		return tenantStorage.getStore()
	}

	getSellerId(): string | undefined {
		return this.get()?.sellerId
	}

	getRole(): string | undefined {
		return this.get()?.role
	}

	isAdmin(): boolean {
		return this.get()?.role === 'admin'
	}

	requireSellerId(): string {
		const sellerId = this.getSellerId()
		if (!sellerId) {
			throw new Error('Tenant context not initialized - sellerId is required')
		}
		return sellerId
	}
}

export { tenantStorage }
