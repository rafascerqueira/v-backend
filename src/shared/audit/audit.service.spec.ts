/**
 * AuditService unit tests
 * Covers: log(), getByEntity(), getByUser(), getRecent()
 */

import { Test } from '@nestjs/testing'
import { PrismaService } from '@/shared/prisma/prisma.service'
import { AuditService } from './audit.service'

const prismaMock = {
	audit_log: {
		create: jest.fn(),
		findMany: jest.fn(),
	},
}

describe('AuditService', () => {
	let service: AuditService

	beforeEach(async () => {
		const module = await Test.createTestingModule({
			providers: [AuditService, { provide: PrismaService, useValue: prismaMock }],
		}).compile()

		service = module.get(AuditService)
		jest.clearAllMocks()
	})

	describe('log', () => {
		it('should create an audit log record', async () => {
			prismaMock.audit_log.create.mockResolvedValueOnce({})

			await service.log({
				action: 'CREATE',
				entity: 'products',
				entityId: 'abc123',
				userId: 'user-1',
				newValue: { name: 'Widget' },
				ipAddress: '127.0.0.1',
				userAgent: 'jest',
			})

			expect(prismaMock.audit_log.create).toHaveBeenCalledWith({
				data: {
					action: 'CREATE',
					entity: 'products',
					entity_id: 'abc123',
					user_id: 'user-1',
					old_value: undefined,
					new_value: { name: 'Widget' },
					metadata: undefined,
					ip_address: '127.0.0.1',
					user_agent: 'jest',
				},
			})
		})

		it('should coerce numeric entityId to string', async () => {
			prismaMock.audit_log.create.mockResolvedValueOnce({})

			await service.log({ action: 'DELETE', entity: 'orders', entityId: 42 })

			expect(prismaMock.audit_log.create).toHaveBeenCalledWith(
				expect.objectContaining({ data: expect.objectContaining({ entity_id: '42' }) }),
			)
		})

		it('should silently swallow errors to avoid breaking the request', async () => {
			prismaMock.audit_log.create.mockRejectedValueOnce(new Error('DB down'))
			const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

			await expect(service.log({ action: 'CREATE', entity: 'products' })).resolves.toBeUndefined()

			consoleSpy.mockRestore()
		})
	})

	describe('getByEntity', () => {
		it('should query by entity and entity_id with default limit of 50', async () => {
			const logs = [{ id: 1 }]
			prismaMock.audit_log.findMany.mockResolvedValueOnce(logs)

			const result = await service.getByEntity('products', '5')

			expect(prismaMock.audit_log.findMany).toHaveBeenCalledWith({
				where: { entity: 'products', entity_id: '5' },
				orderBy: { created_at: 'desc' },
				take: 50,
			})
			expect(result).toEqual(logs)
		})

		it('should respect a custom limit', async () => {
			prismaMock.audit_log.findMany.mockResolvedValueOnce([])

			await service.getByEntity('orders', '1', 10)

			expect(prismaMock.audit_log.findMany).toHaveBeenCalledWith(
				expect.objectContaining({ take: 10 }),
			)
		})
	})

	describe('getByUser', () => {
		it('should query by user_id with default limit of 50', async () => {
			prismaMock.audit_log.findMany.mockResolvedValueOnce([])

			await service.getByUser('user-uuid-1')

			expect(prismaMock.audit_log.findMany).toHaveBeenCalledWith({
				where: { user_id: 'user-uuid-1' },
				orderBy: { created_at: 'desc' },
				take: 50,
			})
		})
	})

	describe('getRecent', () => {
		it('should query recent logs with default limit of 100', async () => {
			prismaMock.audit_log.findMany.mockResolvedValueOnce([])

			await service.getRecent()

			expect(prismaMock.audit_log.findMany).toHaveBeenCalledWith({
				orderBy: { created_at: 'desc' },
				take: 100,
			})
		})

		it('should respect a custom limit', async () => {
			prismaMock.audit_log.findMany.mockResolvedValueOnce([])

			await service.getRecent(25)

			expect(prismaMock.audit_log.findMany).toHaveBeenCalledWith(
				expect.objectContaining({ take: 25 }),
			)
		})
	})
})
