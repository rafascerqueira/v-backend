/**
 * AvatarController unit tests
 * Covers: POST/GET/DELETE /auth/profile/avatar — private, owner-only avatar.
 * Guards mocked: JwtAuthGuard (global default)
 */

import { Readable } from 'node:stream'
import { ConfigService } from '@nestjs/config'
import { Test } from '@nestjs/testing'
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard'
import { AccountService } from '@/modules/users/services/account.service'
import { UploadService } from '@/shared/upload/upload.service'
import { AvatarController } from './avatar.controller'

const accountServiceMock = {
	setAvatar: jest.fn(),
	findById: jest.fn(),
	removeProfilePicture: jest.fn(),
}
const uploadServiceMock = {
	uploadProfileImage: jest.fn(),
	getObject: jest.fn(),
}
const configServiceMock = {
	get: jest.fn((_k: string, fb?: unknown) => fb ?? 'http://localhost:3001'),
}

const mockUser = { sub: 'user-1', email: 'a@b.com', role: 'seller', plan_type: 'free' }

function makeReply() {
	const reply: any = {
		statusCode: 200,
		headers: {} as Record<string, unknown>,
		status: jest.fn(function (this: any, c: number) {
			this.statusCode = c
			return this
		}),
		header: jest.fn(function (this: any, k: string, v: unknown) {
			this.headers[k] = v
			return this
		}),
		send: jest.fn(),
		redirect: jest.fn(),
	}
	return reply
}

function makeFileReq(file: { buffer: Buffer; filename: string; mimetype: string } | null) {
	return {
		file: jest
			.fn()
			.mockResolvedValue(
				file
					? { filename: file.filename, mimetype: file.mimetype, toBuffer: async () => file.buffer }
					: null,
			),
	}
}

describe('AvatarController', () => {
	let controller: AvatarController

	beforeEach(async () => {
		const module = await Test.createTestingModule({
			controllers: [AvatarController],
			providers: [
				{ provide: AccountService, useValue: accountServiceMock },
				{ provide: UploadService, useValue: uploadServiceMock },
				{ provide: ConfigService, useValue: configServiceMock },
			],
		})
			.overrideGuard(JwtAuthGuard)
			.useValue({ canActivate: () => true })
			.compile()

		controller = module.get(AvatarController)
		jest.clearAllMocks()
	})

	describe('upload', () => {
		it('stores privately, persists the key server-side, and returns the proxy URL', async () => {
			const req = makeFileReq({
				buffer: Buffer.from('x'),
				filename: 'a.png',
				mimetype: 'image/png',
			})
			uploadServiceMock.uploadProfileImage.mockResolvedValueOnce({
				path: 'profiles/user-1-profile.png',
			})
			accountServiceMock.setAvatar.mockResolvedValueOnce({
				avatar: 'profiles/user-1-profile.png',
				updatedAt: new Date('2024-01-02'),
			})

			const result = await controller.upload(mockUser as any, req as any)

			expect(uploadServiceMock.uploadProfileImage).toHaveBeenCalledWith(
				Buffer.from('x'),
				'a.png',
				'image/png',
				'user-1',
			)
			expect(accountServiceMock.setAvatar).toHaveBeenCalledWith(
				'user-1',
				'profiles/user-1-profile.png',
			)
			expect(result.avatarUrl).toBe(
				`http://localhost:3001/auth/profile/avatar?v=${new Date('2024-01-02').getTime()}`,
			)
		})
	})

	describe('serve', () => {
		it('streams the object for the owner with private cache headers', async () => {
			accountServiceMock.findById.mockResolvedValueOnce({ avatar: 'profiles/user-1-profile.png' })
			const body = Readable.from(['img'])
			uploadServiceMock.getObject.mockResolvedValueOnce({
				body,
				contentType: 'image/png',
				contentLength: 3,
			})
			const reply = makeReply()

			await controller.serve(mockUser as any, reply)

			expect(reply.headers['Content-Type']).toBe('image/png')
			expect(reply.headers['Cache-Control']).toBe('private, max-age=300')
			expect(reply.send).toHaveBeenCalledWith(body)
		})

		it('returns 404 when the user has no avatar', async () => {
			accountServiceMock.findById.mockResolvedValueOnce({ avatar: null })
			const reply = makeReply()

			await controller.serve(mockUser as any, reply)

			expect(reply.status).toHaveBeenCalledWith(404)
			expect(uploadServiceMock.getObject).not.toHaveBeenCalled()
		})

		it('returns 404 when the stored object is missing', async () => {
			accountServiceMock.findById.mockResolvedValueOnce({ avatar: 'profiles/user-1-profile.png' })
			uploadServiceMock.getObject.mockResolvedValueOnce(null)
			const reply = makeReply()

			await controller.serve(mockUser as any, reply)

			expect(reply.status).toHaveBeenCalledWith(404)
		})

		it('redirects external (OAuth) avatar URLs instead of proxying', async () => {
			accountServiceMock.findById.mockResolvedValueOnce({
				avatar: 'https://lh3.googleusercontent.com/a/x',
			})
			const reply = makeReply()

			await controller.serve(mockUser as any, reply)

			expect(reply.redirect).toHaveBeenCalledWith('https://lh3.googleusercontent.com/a/x')
			expect(uploadServiceMock.getObject).not.toHaveBeenCalled()
		})
	})

	describe('remove', () => {
		it('delegates to removeProfilePicture and returns null avatar', async () => {
			accountServiceMock.removeProfilePicture.mockResolvedValueOnce({ avatar: null })

			const result = await controller.remove(mockUser as any)

			expect(accountServiceMock.removeProfilePicture).toHaveBeenCalledWith('user-1')
			expect(result).toEqual({ avatarUrl: null })
		})
	})
})
