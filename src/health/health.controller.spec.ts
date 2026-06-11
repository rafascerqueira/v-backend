/**
 * HealthController unit tests
 * Covers: GET /health (full check), GET /health/liveness, GET /health/readiness
 * All routes are @Public — no auth guard needed
 */

import {
	DiskHealthIndicator,
	HealthCheckService,
	MemoryHealthIndicator,
	PrismaHealthIndicator,
} from '@nestjs/terminus'
import { Test } from '@nestjs/testing'
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard'
import { PrismaService } from '@/shared/prisma/prisma.service'
import { HealthController } from './health.controller'

const healthCheckServiceMock = {
	check: jest.fn(),
}

const prismaHealthMock = {
	pingCheck: jest.fn(),
}

const memoryMock = {
	checkHeap: jest.fn(),
	checkRSS: jest.fn(),
}

const diskMock = {
	checkStorage: jest.fn(),
}

const prismaServiceMock = {}

describe('HealthController', () => {
	let controller: HealthController

	beforeEach(async () => {
		const module = await Test.createTestingModule({
			controllers: [HealthController],
			providers: [
				{ provide: HealthCheckService, useValue: healthCheckServiceMock },
				{ provide: PrismaHealthIndicator, useValue: prismaHealthMock },
				{ provide: MemoryHealthIndicator, useValue: memoryMock },
				{ provide: DiskHealthIndicator, useValue: diskMock },
				{ provide: PrismaService, useValue: prismaServiceMock },
			],
		})
			.overrideGuard(JwtAuthGuard)
			.useValue({ canActivate: () => true })
			.compile()

		controller = module.get(HealthController)
		jest.clearAllMocks()
	})

	describe('check', () => {
		it('should run all health checks and return healthy status', async () => {
			const healthResult = {
				status: 'ok',
				info: { database: { status: 'up' }, memory_heap: { status: 'up' } },
				error: {},
				details: {},
			}
			healthCheckServiceMock.check.mockResolvedValueOnce(healthResult)

			const result = await controller.check()

			expect(healthCheckServiceMock.check).toHaveBeenCalledWith(
				expect.arrayContaining([expect.any(Function)]),
			)
			expect(result).toEqual(healthResult)
		})

		it('should propagate health check errors when a check fails', async () => {
			healthCheckServiceMock.check.mockRejectedValueOnce(new Error('Database unreachable'))

			await expect(controller.check()).rejects.toThrow('Database unreachable')
		})
	})

	describe('liveness', () => {
		it('should return ok status with timestamp', () => {
			const result = controller.liveness()

			expect(result).toMatchObject({ status: 'ok' })
			expect(typeof result.timestamp).toBe('string')
			expect(new Date(result.timestamp).toISOString()).toBe(result.timestamp)
		})
	})

	describe('readiness', () => {
		it('should run database check and return healthy status', async () => {
			const readinessResult = {
				status: 'ok',
				info: { database: { status: 'up' } },
				error: {},
				details: {},
			}
			healthCheckServiceMock.check.mockResolvedValueOnce(readinessResult)

			const result = await controller.readiness()

			expect(healthCheckServiceMock.check).toHaveBeenCalled()
			expect(result).toEqual(readinessResult)
		})
	})
})
