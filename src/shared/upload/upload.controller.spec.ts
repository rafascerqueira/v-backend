/**
 * UploadController unit tests
 * Covers: POST /upload/product, POST /upload/profile, DELETE /upload/:encodedPath
 * Guards mocked: JwtAuthGuard
 * Note: multipart parsing is mocked at the request level
 */

import { BadRequestException, ForbiddenException } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard'
import { UploadController } from './upload.controller'
import { UploadService } from './upload.service'

const uploadServiceMock = {
	uploadProductImage: jest.fn(),
	uploadProfileImage: jest.fn(),
	deleteFile: jest.fn(),
}

function makeFileRequest(
	sub: string,
	file: { buffer: Buffer; filename: string; mimetype: string } | null,
) {
	return {
		user: { sub },
		file: jest.fn().mockResolvedValue(
			file
				? {
						buffer: undefined,
						filename: file.filename,
						mimetype: file.mimetype,
						toBuffer: jest.fn().mockResolvedValue(file.buffer),
					}
				: null,
		),
	}
}

describe('UploadController', () => {
	let controller: UploadController

	beforeEach(async () => {
		const module = await Test.createTestingModule({
			controllers: [UploadController],
			providers: [{ provide: UploadService, useValue: uploadServiceMock }],
		})
			.overrideGuard(JwtAuthGuard)
			.useValue({ canActivate: () => true })
			.compile()

		controller = module.get(UploadController)
		jest.clearAllMocks()
	})

	describe('uploadProductImage', () => {
		it('should upload product image and return the result', async () => {
			const buffer = Buffer.from('fake-image')
			const req = makeFileRequest('seller-uuid-1', {
				buffer,
				filename: 'product.jpg',
				mimetype: 'image/jpeg',
			})
			const uploadResult = { url: 'https://cdn.example.com/product.jpg' }
			uploadServiceMock.uploadProductImage.mockResolvedValueOnce(uploadResult)

			const result = await controller.uploadProductImage(req as any)

			expect(uploadServiceMock.uploadProductImage).toHaveBeenCalledWith(
				buffer,
				'product.jpg',
				'image/jpeg',
				'seller-uuid-1',
			)
			expect(result).toEqual(uploadResult)
		})

		it('should throw BadRequestException when no file is provided', async () => {
			const req = makeFileRequest('seller-uuid-1', null)

			await expect(controller.uploadProductImage(req as any)).rejects.toThrow(BadRequestException)
		})
	})

	describe('deleteFile', () => {
		const ownerReq = { user: { sub: 'seller-1' } }

		it('should decode base64 path and delete the caller-owned file', async () => {
			uploadServiceMock.deleteFile.mockResolvedValueOnce(true)

			const path = 'products/seller-1/image.jpg'
			const encodedPath = Buffer.from(path).toString('base64')

			const result = await controller.deleteFile(encodedPath, ownerReq as any)

			expect(uploadServiceMock.deleteFile).toHaveBeenCalledWith(path)
			expect(result).toEqual({ deleted: true })
		})

		it('should allow deleting the caller-owned profile image', async () => {
			uploadServiceMock.deleteFile.mockResolvedValueOnce(true)

			const path = 'profiles/seller-1-profile.jpg'
			const encodedPath = Buffer.from(path).toString('base64')

			const result = await controller.deleteFile(encodedPath, ownerReq as any)

			expect(result).toEqual({ deleted: true })
		})

		it('should return deleted: false when caller-owned file does not exist', async () => {
			uploadServiceMock.deleteFile.mockResolvedValueOnce(false)

			const encodedPath = Buffer.from('products/seller-1/missing.jpg').toString('base64')

			const result = await controller.deleteFile(encodedPath, ownerReq as any)

			expect(result).toEqual({ deleted: false })
		})

		it('should forbid deleting another tenant product image (IDOR)', async () => {
			const encodedPath = Buffer.from('products/other-seller/image.jpg').toString('base64')

			await expect(controller.deleteFile(encodedPath, ownerReq as any)).rejects.toThrow(
				ForbiddenException,
			)
			expect(uploadServiceMock.deleteFile).not.toHaveBeenCalled()
		})

		it("should forbid deleting another user's profile image (IDOR)", async () => {
			const encodedPath = Buffer.from('profiles/other-user-profile.jpg').toString('base64')

			await expect(controller.deleteFile(encodedPath, ownerReq as any)).rejects.toThrow(
				ForbiddenException,
			)
			expect(uploadServiceMock.deleteFile).not.toHaveBeenCalled()
		})
	})
})
