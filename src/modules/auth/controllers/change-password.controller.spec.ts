/**
 * ChangePasswordController unit tests
 * Covers: POST /auth/change-password — change authenticated user's password
 * Guards mocked: JwtAuthGuard
 */

import { NotFoundException, UnauthorizedException } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard'
import { AccountService } from '@/modules/users/services/account.service'
import { SessionService } from '../services/session.service'
import { ChangePasswordController } from './change-password.controller'

const accountServiceMock = {
	changePassword: jest.fn(),
}

const sessionServiceMock = {
	reissue: jest.fn(),
}

const mockUser = {
	sub: 'user-uuid-1',
	email: 'test@example.com',
	role: 'seller' as const,
	plan_type: 'free' as const,
	sid: 'sid-1',
}

const reissued = {
	accessToken: 'new-access',
	refreshToken: 'new-refresh',
	expiresIn: 900,
	persistent: true,
	sessionTtl: 2592000,
}

const request = { cookies: {} }

function makeResponse() {
	return { setCookie: jest.fn() }
}

describe('ChangePasswordController', () => {
	let controller: ChangePasswordController

	beforeEach(async () => {
		const module = await Test.createTestingModule({
			controllers: [ChangePasswordController],
			providers: [
				{ provide: AccountService, useValue: accountServiceMock },
				{ provide: SessionService, useValue: sessionServiceMock },
			],
		})
			.overrideGuard(JwtAuthGuard)
			.useValue({ canActivate: () => true })
			.compile()

		controller = module.get(ChangePasswordController)
		jest.clearAllMocks()
	})

	describe('changePassword', () => {
		it('changes the password and signs this device back in under the new session version', async () => {
			accountServiceMock.changePassword.mockResolvedValueOnce(undefined)
			sessionServiceMock.reissue.mockResolvedValueOnce(reissued)
			const res = makeResponse()

			const result = await controller.changePassword(
				mockUser,
				{ currentPassword: 'old', newPassword: 'newPass123' },
				request as any,
				res as any,
			)

			expect(accountServiceMock.changePassword).toHaveBeenCalledWith(
				'user-uuid-1',
				'old',
				'newPass123',
			)
			// Reissue runs after the password write (which ended every session).
			expect(sessionServiceMock.reissue).toHaveBeenCalledWith(mockUser)
			expect(accountServiceMock.changePassword.mock.invocationCallOrder[0]).toBeLessThan(
				sessionServiceMock.reissue.mock.invocationCallOrder[0],
			)
			expect(res.setCookie.mock.calls.map(([name]) => name)).toEqual([
				'access_token',
				'refresh_token',
				'csrf_token',
				'vd_session',
			])
			expect(result).toEqual({ message: 'Senha alterada com sucesso' })
		})

		it('should propagate UnauthorizedException when current password is wrong', async () => {
			accountServiceMock.changePassword.mockRejectedValueOnce(
				new UnauthorizedException('Senha atual incorreta'),
			)

			await expect(
				controller.changePassword(
					mockUser,
					{ currentPassword: 'wrong', newPassword: 'newPass123' },
					request as any,
					makeResponse() as any,
				),
			).rejects.toThrow(UnauthorizedException)
			// A wrong password changes nothing about the sessions.
			expect(sessionServiceMock.reissue).not.toHaveBeenCalled()
		})

		it('should propagate NotFoundException when user is not found', async () => {
			accountServiceMock.changePassword.mockRejectedValueOnce(
				new NotFoundException('User not found'),
			)

			await expect(
				controller.changePassword(
					mockUser,
					{ currentPassword: 'old', newPassword: 'newPass123' },
					request as any,
					makeResponse() as any,
				),
			).rejects.toThrow(NotFoundException)
		})
	})
})
