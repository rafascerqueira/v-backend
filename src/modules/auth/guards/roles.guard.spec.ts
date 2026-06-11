/**
 * RolesGuard unit tests.
 * Covers: no-roles-metadata pass-through, missing user, DB role re-verification
 *         (the role is read from the database, NOT trusted from the JWT claim),
 *         role mismatch -> forbidden, and revoked/missing account -> forbidden.
 *
 * PrismaService is mocked at the constructor level (no real DB). The guard only
 * ever calls prisma.account.findUnique, so that single method is stubbed.
 */
import { ForbiddenException } from '@nestjs/common'
import type { Reflector } from '@nestjs/core'
import type { PrismaService } from '@/shared/prisma/prisma.service'
import { RolesGuard } from './roles.guard'

function makeContext(req: any): any {
	return {
		switchToHttp: () => ({ getRequest: () => req }),
		getHandler: () => null,
		getClass: () => null,
	}
}

describe('RolesGuard', () => {
	let guard: RolesGuard
	let reflector: { getAllAndOverride: jest.Mock }
	let prisma: { account: { findUnique: jest.Mock } }

	beforeEach(() => {
		reflector = { getAllAndOverride: jest.fn() }
		prisma = { account: { findUnique: jest.fn() } }
		guard = new RolesGuard(reflector as unknown as Reflector, prisma as unknown as PrismaService)
	})

	it('passes through when no @Roles() metadata is present (undefined)', async () => {
		reflector.getAllAndOverride.mockReturnValue(undefined)
		const req = { user: { sub: 'acc-1' } }

		await expect(guard.canActivate(makeContext(req))).resolves.toBe(true)
		// No DB round-trip when the route is unguarded.
		expect(prisma.account.findUnique).not.toHaveBeenCalled()
	})

	it('forbids when there is no authenticated user', async () => {
		reflector.getAllAndOverride.mockReturnValue(['admin'])
		const req = { user: undefined }

		await expect(guard.canActivate(makeContext(req))).rejects.toThrow(
			new ForbiddenException('Acesso negado'),
		)
		expect(prisma.account.findUnique).not.toHaveBeenCalled()
	})

	it('forbids when the user object lacks a sub', async () => {
		reflector.getAllAndOverride.mockReturnValue(['admin'])
		const req = { user: { email: 'a@b.com' } }

		await expect(guard.canActivate(makeContext(req))).rejects.toThrow(
			new ForbiddenException('Acesso negado'),
		)
	})

	it('re-verifies the role against the DB and allows a matching role', async () => {
		reflector.getAllAndOverride.mockReturnValue(['admin'])
		prisma.account.findUnique.mockResolvedValue({ role: 'admin' })
		const req = { user: { sub: 'acc-1', role: 'seller' } } // stale JWT claim is ignored

		await expect(guard.canActivate(makeContext(req))).resolves.toBe(true)
		expect(prisma.account.findUnique).toHaveBeenCalledWith({
			where: { id: 'acc-1' },
			select: { role: true },
		})
	})

	it('forbids when the DB role does not match (does NOT trust the JWT claim)', async () => {
		reflector.getAllAndOverride.mockReturnValue(['admin'])
		// JWT says admin, but the database says seller -> access denied.
		prisma.account.findUnique.mockResolvedValue({ role: 'seller' })
		const req = { user: { sub: 'acc-1', role: 'admin' } }

		await expect(guard.canActivate(makeContext(req))).rejects.toThrow(
			new ForbiddenException('Acesso restrito a administradores'),
		)
	})

	it('forbids when the account no longer exists (revoked)', async () => {
		reflector.getAllAndOverride.mockReturnValue(['admin'])
		prisma.account.findUnique.mockResolvedValue(null)
		const req = { user: { sub: 'acc-deleted', role: 'admin' } }

		await expect(guard.canActivate(makeContext(req))).rejects.toThrow(
			new ForbiddenException('Acesso restrito a administradores'),
		)
	})

	it('allows when the DB role is one of several required roles', async () => {
		reflector.getAllAndOverride.mockReturnValue(['admin', 'support'])
		prisma.account.findUnique.mockResolvedValue({ role: 'support' })
		const req = { user: { sub: 'acc-2' } }

		await expect(guard.canActivate(makeContext(req))).resolves.toBe(true)
	})

	it('forbids on empty @Roles() metadata because [] is truthy and matches nothing', async () => {
		// `@Roles()` with no args sets metadata to [], which passes the `!requiredRoles`
		// guard (it is truthy) but can never satisfy includes() -> always forbidden.
		reflector.getAllAndOverride.mockReturnValue([])
		prisma.account.findUnique.mockResolvedValue({ role: 'admin' })
		const req = { user: { sub: 'acc-1' } }

		await expect(guard.canActivate(makeContext(req))).rejects.toThrow(
			new ForbiddenException('Acesso restrito a administradores'),
		)
	})
})
