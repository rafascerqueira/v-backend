/**
 * S3StorageProvider unit tests
 *
 * The AWS SDK is mocked — we assert the provider issues the right commands and
 * builds public URLs correctly, without touching the network.
 */
import { Readable } from 'node:stream'
import {
	DeleteObjectCommand,
	DeleteObjectsCommand,
	GetObjectCommand,
	ListObjectsV2Command,
	PutObjectCommand,
} from '@aws-sdk/client-s3'
import { S3StorageProvider } from './s3-storage.provider'

const sendMock = jest.fn()

jest.mock('@aws-sdk/client-s3', () => {
	const actual = jest.requireActual('@aws-sdk/client-s3')
	return {
		...actual,
		S3Client: jest.fn().mockImplementation(() => ({ send: sendMock })),
	}
})

function makeConfig(overrides: Record<string, unknown> = {}) {
	const s3 = {
		bucket: 'vendinhas-uploads',
		region: 'us-east-1',
		endpoint: undefined,
		accessKeyId: 'key',
		secretAccessKey: 'secret',
		forcePathStyle: false,
		publicUrl: undefined,
		...overrides,
	}
	return { get: jest.fn(() => s3) }
}

describe('S3StorageProvider', () => {
	beforeEach(() => {
		sendMock.mockReset()
		sendMock.mockResolvedValue({})
	})

	it('throws if no bucket is configured', () => {
		expect(() => new S3StorageProvider({ get: () => ({ bucket: undefined }) } as never)).toThrow(
			/STORAGE_S3_BUCKET/,
		)
	})

	it('puts the object and returns its public URL (virtual-hosted AWS default)', async () => {
		const provider = new S3StorageProvider(makeConfig() as never)

		const url = await provider.save('products/seller-1/img.jpg', Buffer.from('x'), 'image/jpeg')

		expect(sendMock).toHaveBeenCalledTimes(1)
		const command = sendMock.mock.calls[0][0]
		expect(command).toBeInstanceOf(PutObjectCommand)
		expect(command.input).toMatchObject({
			Bucket: 'vendinhas-uploads',
			Key: 'products/seller-1/img.jpg',
			ContentType: 'image/jpeg',
		})
		expect(url).toBe(
			'https://vendinhas-uploads.s3.us-east-1.amazonaws.com/products/seller-1/img.jpg',
		)
	})

	it('derives a path-style URL for MinIO-like endpoints', () => {
		const provider = new S3StorageProvider(
			makeConfig({ endpoint: 'http://minio:9000', forcePathStyle: true }) as never,
		)

		expect(provider.getUrl('profiles/u1-profile.png')).toBe(
			'http://minio:9000/vendinhas-uploads/profiles/u1-profile.png',
		)
	})

	it('prefers an explicit public URL (CDN) and trims trailing slashes', () => {
		const provider = new S3StorageProvider(
			makeConfig({ publicUrl: 'https://cdn.vendinhas.app/' }) as never,
		)

		expect(provider.getUrl('products/s/x.webp')).toBe('https://cdn.vendinhas.app/products/s/x.webp')
	})

	it('deletes the object and returns true', async () => {
		const provider = new S3StorageProvider(makeConfig() as never)

		const ok = await provider.delete('products/seller-1/img.jpg')

		expect(ok).toBe(true)
		const command = sendMock.mock.calls[0][0]
		expect(command).toBeInstanceOf(DeleteObjectCommand)
		expect(command.input).toMatchObject({
			Bucket: 'vendinhas-uploads',
			Key: 'products/seller-1/img.jpg',
		})
	})

	it('returns false when delete fails', async () => {
		sendMock.mockRejectedValueOnce(new Error('boom'))
		const provider = new S3StorageProvider(makeConfig() as never)

		expect(await provider.delete('products/seller-1/img.jpg')).toBe(false)
	})

	describe('getObject', () => {
		it('returns the body + metadata for an existing key', async () => {
			const body = Readable.from(['bytes'])
			sendMock.mockResolvedValueOnce({ Body: body, ContentType: 'image/webp', ContentLength: 5 })
			const provider = new S3StorageProvider(makeConfig() as never)

			const obj = await provider.getObject('profiles/u1-profile.webp')

			expect(sendMock.mock.calls[0][0]).toBeInstanceOf(GetObjectCommand)
			expect(obj).toEqual({ body, contentType: 'image/webp', contentLength: 5 })
		})

		it('returns null for a missing key (NoSuchKey)', async () => {
			sendMock.mockRejectedValueOnce(Object.assign(new Error('nope'), { name: 'NoSuchKey' }))
			const provider = new S3StorageProvider(makeConfig() as never)

			expect(await provider.getObject('profiles/missing.webp')).toBeNull()
		})
	})

	describe('deletePrefix', () => {
		it('lists then bulk-deletes every object under the prefix', async () => {
			sendMock
				.mockResolvedValueOnce({
					Contents: [{ Key: 'products/s1/a.jpg' }, { Key: 'products/s1/b.jpg' }],
					IsTruncated: false,
				})
				.mockResolvedValueOnce({}) // DeleteObjects
			const provider = new S3StorageProvider(makeConfig() as never)

			const count = await provider.deletePrefix('products/s1/')

			expect(count).toBe(2)
			expect(sendMock.mock.calls[0][0]).toBeInstanceOf(ListObjectsV2Command)
			const del = sendMock.mock.calls[1][0]
			expect(del).toBeInstanceOf(DeleteObjectsCommand)
			expect(del.input.Delete.Objects).toEqual([
				{ Key: 'products/s1/a.jpg' },
				{ Key: 'products/s1/b.jpg' },
			])
		})

		it('returns 0 when nothing matches the prefix', async () => {
			sendMock.mockResolvedValueOnce({ Contents: [], IsTruncated: false })
			const provider = new S3StorageProvider(makeConfig() as never)

			expect(await provider.deletePrefix('products/empty/')).toBe(0)
		})
	})
})
