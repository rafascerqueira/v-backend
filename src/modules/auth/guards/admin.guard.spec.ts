/**
 * AdminGuard unit tests.
 * Covers: missing user, DB re-verification of the admin role (so a revoked admin
 *         loses access immediately rather than staying admin until token expiry),
 *         non-admin DB role -> forbidden, and missing account -> forbidden.
 *
 * PrismaService is mocked at the constructor level (no real DB).
 */
import { ForbiddenException } from '@nestjs/common'
import type { PrismaService } from '@/shared/prisma/prisma.service'
import { AdminGuard } from './admin.guard'

function makeContext(req: any): any {
	return {
		switchToHttp: () => ({ getRequest: () => req }),
		getHandler: () => null,
		getClass: () => null,
	}
}

describe('AdminGuard', () => {
	let guard: AdminGuard
	let prisma: { account: { findUnique: jest.Mock } }

	beforeEach(() => {
		prisma = { account: { findUnique: jest.fn() } }
		guard = new AdminGuard(prisma as unknown as PrismaService)
	})

	it('forbids when there is no authenticated user', async () => {
		const req = { user: undefined }

		await expect(guard.canActivate(makeContext(req))).rejects.toThrow(
			new ForbiddenException('Authentication required'),
		)
		expect(prisma.account.findUnique).not.toHaveBeenCalled()
	})

	it('forbids when the user object lacks a sub', async () => {
		const req = { user: { email: 'a@b.com' } }

		await expect(guard.canActivate(makeContext(req))).rejects.toThrow(
			new ForbiddenException('Authentication required'),
		)
	})

	it('allows when the DB confirms the account is an admin', async () => {
		prisma.account.findUnique.mockResolvedValue({ role: 'admin' })
		const req = { user: { sub: 'acc-1', role: 'seller' } } // stale JWT claim is ignored

		await expect(guard.canActivate(makeContext(req))).resolves.toBe(true)
		expect(prisma.account.findUnique).toHaveBeenCalledWith({
			where: { id: 'acc-1' },
			select: { role: true },
		})
	})

	it('forbids a revoked admin: JWT claims admin but the DB now says seller', async () => {
		prisma.account.findUnique.mockResolvedValue({ role: 'seller' })
		const req = { user: { sub: 'acc-1', role: 'admin' } }

		await expect(guard.canActivate(makeContext(req))).rejects.toThrow(
			new ForbiddenException('Admin access required'),
		)
	})

	it('forbids when the account no longer exists', async () => {
		prisma.account.findUnique.mockResolvedValue(null)
		const req = { user: { sub: 'acc-deleted', role: 'admin' } }

		await expect(guard.canActivate(makeContext(req))).rejects.toThrow(
			new ForbiddenException('Admin access required'),
		)
	})
})
