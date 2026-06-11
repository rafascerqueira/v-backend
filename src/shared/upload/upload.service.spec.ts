/**
 * UploadService unit tests
 *
 * Focus: the security boundaries we promise to enforce.
 *
 *  - validateFile: size / MIME-type rejection
 *  - processImage: sharp-based format detection (rejects SVG, GIF, plain text)
 *  - uploadProductImage / uploadProfileImage: tenant-scoped paths, re-encoding,
 *    filename derivation from sharp's detected format (NOT client-supplied)
 *  - deleteFile: path-traversal guard, absolute-path rejection, missing-file handling
 *
 * These tests use real sharp + a tmp uploadDir on disk (via the LocalStorageProvider)
 * because the path-traversal defense relies on real path.resolve() behavior, and the
 * format defense relies on real sharp metadata reads. Mocking those would test the
 * mocks, not the guarantees.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BadRequestException } from '@nestjs/common'
import sharp from 'sharp'
import { LocalStorageProvider } from '../storage/local-storage.provider'
import { UploadService } from './upload.service'

async function makeJpeg(width = 32, height = 32): Promise<Buffer> {
	return sharp({
		create: { width, height, channels: 3, background: { r: 200, g: 100, b: 50 } },
	})
		.jpeg()
		.toBuffer()
}

async function makePng(width = 32, height = 32): Promise<Buffer> {
	return sharp({
		create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
	})
		.png()
		.toBuffer()
}

async function makeGif(): Promise<Buffer> {
	// Minimal valid 1x1 GIF
	return Buffer.from([
		0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00, 0x00, 0x00, 0x00,
		0xff, 0xff, 0xff, 0x21, 0xf9, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x2c, 0x00, 0x00, 0x00, 0x00,
		0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x44, 0x01, 0x00, 0x3b,
	])
}

function makeConfigService(uploadDir: string) {
	return {
		get: jest.fn((key: string, fallback?: unknown) => {
			if (key === 'upload.dir') return uploadDir
			if (key === 'appUrl') return 'http://localhost:3001'
			return fallback
		}),
	}
}

describe('UploadService', () => {
	let uploadDir: string
	let service: UploadService

	beforeEach(() => {
		uploadDir = mkdtempSync(join(tmpdir(), 'upload-service-spec-'))
		const storage = new LocalStorageProvider(makeConfigService(uploadDir) as never)
		service = new UploadService(storage)
	})

	afterEach(() => {
		rmSync(uploadDir, { recursive: true, force: true })
	})

	describe('validateFile (via uploadProductImage)', () => {
		it('rejects files larger than the configured limit', async () => {
			const oversized = Buffer.alloc(6 * 1024 * 1024)

			await expect(
				service.uploadProductImage(oversized, 'big.jpg', 'image/jpeg', 'seller-1'),
			).rejects.toThrow(/Arquivo muito grande/)
		})

		it('rejects MIME types outside the allowlist', async () => {
			const jpeg = await makeJpeg()

			await expect(
				service.uploadProductImage(jpeg, 'evil.html', 'text/html', 'seller-1'),
			).rejects.toThrow(/Tipo de arquivo não permitido/)
		})
	})

	describe('processImage format detection', () => {
		it('rejects buffers that sharp cannot decode as an image (HTML disguised as image)', async () => {
			const html = Buffer.from('<script>alert(1)</script>')

			// MIME passes (client lied), but sharp will see the buffer is not a real image.
			await expect(
				service.uploadProductImage(html, 'evil.jpg', 'image/jpeg', 'seller-1'),
			).rejects.toThrow(BadRequestException)
		})

		it('rejects GIF (allowed by sharp but not in our safe-format allowlist)', async () => {
			const gif = await makeGif()

			// We claim image/png to bypass validateFile and reach processImage.
			await expect(
				service.uploadProductImage(gif, 'anim.png', 'image/png', 'seller-1'),
			).rejects.toThrow(/Formato de imagem não suportado/)
		})

		it('accepts a real JPEG and re-encodes the output (strips EXIF/metadata)', async () => {
			const original = await sharp({
				create: { width: 100, height: 100, channels: 3, background: '#000' },
			})
				.withMetadata({ exif: { IFD0: { Copyright: 'leak-me-please' } } })
				.jpeg()
				.toBuffer()

			const result = await service.uploadProductImage(
				original,
				'photo.jpg',
				'image/jpeg',
				'seller-1',
			)

			const onDisk = readFileSync(join(uploadDir, result.path))
			const meta = await sharp(onDisk).metadata()
			// sharp drops EXIF by default when re-encoding (no withMetadata())
			expect(meta.exif).toBeUndefined()
			expect(meta.format).toBe('jpeg')
		})
	})

	describe('uploadProductImage', () => {
		it('writes to a tenant-scoped subfolder', async () => {
			const jpeg = await makeJpeg()

			const result = await service.uploadProductImage(jpeg, 'p.jpg', 'image/jpeg', 'seller-42')

			expect(result.path.startsWith(join('products', 'seller-42'))).toBe(true)
			expect(existsSync(join(uploadDir, result.path))).toBe(true)
			expect(result.url).toBe(`http://localhost:3001/uploads/${result.path}`)
		})

		it('derives the stored extension from sharp-detected format, not the client filename', async () => {
			const png = await makePng()

			// Client says ".jpg" but the bytes are PNG; we must store as .png.
			const result = await service.uploadProductImage(png, 'tricky.jpg', 'image/png', 'seller-1')

			expect(result.filename.endsWith('.png')).toBe(true)
		})
	})

	describe('uploadProfileImage', () => {
		it('overwrites the previous profile image for the same user', async () => {
			const first = await makeJpeg(32, 32)
			const second = await makeJpeg(48, 48)

			const r1 = await service.uploadProfileImage(first, 'a.jpg', 'image/jpeg', 'user-1')
			const r2 = await service.uploadProfileImage(second, 'b.jpg', 'image/jpeg', 'user-1')

			// Stable filename keyed on user-id; previous file is replaced in place.
			expect(r1.filename).toBe(r2.filename)
			expect(r2.filename).toBe('user-1-profile.jpg')
			expect(existsSync(join(uploadDir, r2.path))).toBe(true)
		})
	})

	describe('deleteFile — path traversal guard', () => {
		it('blocks traversal via ../ even if it resolves outside the upload dir', async () => {
			// Plant a file outside uploadDir
			const outsideDir = mkdtempSync(join(tmpdir(), 'outside-'))
			const victim = join(outsideDir, 'secret.txt')
			writeFileSync(victim, 'do-not-delete')

			try {
				const traversal = `../${require('node:path').basename(outsideDir)}/secret.txt`
				const deleted = await service.deleteFile(traversal)

				expect(deleted).toBe(false)
				expect(existsSync(victim)).toBe(true)
			} finally {
				rmSync(outsideDir, { recursive: true, force: true })
			}
		})

		it('blocks absolute paths', async () => {
			const deleted = await service.deleteFile('/etc/passwd')
			expect(deleted).toBe(false)
		})

		it('returns false for files that do not exist (no throw)', async () => {
			const deleted = await service.deleteFile('products/seller-1/nope.jpg')
			expect(deleted).toBe(false)
		})

		it('deletes a real file located inside the upload dir', async () => {
			const jpeg = await makeJpeg()
			const uploaded = await service.uploadProductImage(jpeg, 'p.jpg', 'image/jpeg', 'seller-1')

			expect(existsSync(join(uploadDir, uploaded.path))).toBe(true)

			const deleted = await service.deleteFile(uploaded.path)

			expect(deleted).toBe(true)
			expect(existsSync(join(uploadDir, uploaded.path))).toBe(false)
		})
	})
})
