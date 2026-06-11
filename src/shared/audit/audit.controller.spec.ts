/**
 * AuditController unit tests
 * Covers: GET /audit, GET /audit/entity, GET /audit/user
 * Note: AuditController is admin-only (@UseGuards(RolesGuard) + @Roles('admin')),
 *       so RolesGuard must be overridden — it injects PrismaService, which is not
 *       available in this unit testing module. JwtAuthGuard is mocked as a precaution.
 */

import { Test } from '@nestjs/testing'
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard'
import { RolesGuard } from '@/modules/auth/guards/roles.guard'
import { AuditController } from './audit.controller'
import { AuditService } from './audit.service'

const serviceMock = {
	getRecent: jest.fn(),
	getByEntity: jest.fn(),
	getByUser: jest.fn(),
}

describe('AuditController', () => {
	let controller: AuditController

	beforeEach(async () => {
		const module = await Test.createTestingModule({
			controllers: [AuditController],
			providers: [{ provide: AuditService, useValue: serviceMock }],
		})
			.overrideGuard(JwtAuthGuard)
			.useValue({ canActivate: () => true })
			.overrideGuard(RolesGuard)
			.useValue({ canActivate: () => true })
			.compile()

		controller = module.get(AuditController)
		jest.clearAllMocks()
	})

	describe('getRecent', () => {
		it('should return recent audit logs with default limit of 100', async () => {
			const logs = [{ id: 'log-1', action: 'create' }]
			serviceMock.getRecent.mockResolvedValueOnce(logs)

			const result = await controller.getRecent()

			expect(serviceMock.getRecent).toHaveBeenCalledWith(100)
			expect(result).toEqual(logs)
		})

		it('should parse limit query param as integer', async () => {
			serviceMock.getRecent.mockResolvedValueOnce([])

			await controller.getRecent('25')

			expect(serviceMock.getRecent).toHaveBeenCalledWith(25)
		})
	})

	describe('getByEntity', () => {
		it('should return audit logs for a specific entity with default limit of 50', async () => {
			const logs = [{ id: 'log-2', entity: 'product', entityId: '1' }]
			serviceMock.getByEntity.mockResolvedValueOnce(logs)

			const result = await controller.getByEntity('product', '1')

			expect(serviceMock.getByEntity).toHaveBeenCalledWith('product', '1', 50)
			expect(result).toEqual(logs)
		})

		it('should parse limit as integer', async () => {
			serviceMock.getByEntity.mockResolvedValueOnce([])

			await controller.getByEntity('order', '42', '10')

			expect(serviceMock.getByEntity).toHaveBeenCalledWith('order', '42', 10)
		})
	})

	describe('getByUser', () => {
		it('should return audit logs for a specific user with default limit of 50', async () => {
			const logs = [{ id: 'log-3', userId: 'user-uuid-1' }]
			serviceMock.getByUser.mockResolvedValueOnce(logs)

			const result = await controller.getByUser('user-uuid-1')

			expect(serviceMock.getByUser).toHaveBeenCalledWith('user-uuid-1', 50)
			expect(result).toEqual(logs)
		})

		it('should parse limit as integer', async () => {
			serviceMock.getByUser.mockResolvedValueOnce([])

			await controller.getByUser('user-uuid-1', '20')

			expect(serviceMock.getByUser).toHaveBeenCalledWith('user-uuid-1', 20)
		})
	})
})
