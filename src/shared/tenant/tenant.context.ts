import { AsyncLocalStorage } from 'node:async_hooks'
import { Injectable, UnauthorizedException } from '@nestjs/common'

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
			// No authenticated account behind this call: answer 401 (a raw Error would
			// surface as a 500).
			throw new UnauthorizedException({
				statusCode: 401,
				error: 'Unauthorized',
				message: 'Sua sessão expirou. Entre novamente.',
				code: 'SESSION_EXPIRED',
			})
		}
		return sellerId
	}
}

export { tenantStorage }
