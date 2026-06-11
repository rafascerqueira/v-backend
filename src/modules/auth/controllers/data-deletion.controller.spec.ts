/**
 * DataDeletionController unit tests
 * Covers: POST /auth/data-deletion — LGPD account anonymization
 * Guards mocked: JwtAuthGuard
 */

import { UnauthorizedException } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard'
import { AccountService } from '@/modules/users/services/account.service'
import { DataDeletionController } from './data-deletion.controller'

const accountServiceMock = {
	anonymizeAccount: jest.fn(),
}

const mockUser = { sub: 'user-uuid-1' }

describe('DataDeletionController', () => {
	let controller: DataDeletionController

	beforeEach(async () => {
		const module = await Test.createTestingModule({
			controllers: [DataDeletionController],
			providers: [{ provide: AccountService, useValue: accountServiceMock }],
		})
			.overrideGuard(JwtAuthGuard)
			.useValue({ canActivate: () => true })
			.compile()

		controller = module.get(DataDeletionController)
		jest.clearAllMocks()
	})

	describe('handle', () => {
		const validBody = {
			password: 'my-current-password',
			confirmation: 'DELETAR MINHA CONTA' as const,
		}

		it('should return success message when password is valid', async () => {
			accountServiceMock.anonymizeAccount.mockResolvedValueOnce(true)

			const result = await controller.handle(mockUser, validBody)

			expect(accountServiceMock.anonymizeAccount).toHaveBeenCalledWith(
				'user-uuid-1',
				'my-current-password',
			)
			expect(result).toMatchObject({ message: expect.stringContaining('anonimizados') })
		})

		it('should throw UnauthorizedException when password is incorrect', async () => {
			accountServiceMock.anonymizeAccount.mockResolvedValueOnce(false)

			await expect(controller.handle(mockUser, validBody)).rejects.toThrow(UnauthorizedException)
		})

		it('should propagate unexpected errors from service', async () => {
			accountServiceMock.anonymizeAccount.mockRejectedValueOnce(new Error('DB failure'))

			await expect(controller.handle(mockUser, validBody)).rejects.toThrow('DB failure')
		})
	})
})
