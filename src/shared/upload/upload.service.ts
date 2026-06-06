import { STORAGE_PROVIDER, type StorageProvider } from '@infrastructure/storage/storage.types'
import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common'
import sharp from 'sharp'

export interface UploadOptions {
	maxSizeBytes?: number
	allowedMimeTypes?: string[]
	resize?: {
		width?: number
		height?: number
		fit?: 'cover' | 'contain' | 'fill' | 'inside' | 'outside'
	}
	quality?: number
}

export interface UploadResult {
	filename: string
	originalName: string
	path: string
	url: string
	size: number
	mimeType: string
	width?: number
	height?: number
}

const DEFAULT_OPTIONS: UploadOptions = {
	maxSizeBytes: 5 * 1024 * 1024, // 5MB
	allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
	resize: {
		width: 1200,
		height: 1200,
		fit: 'inside',
	},
	quality: 80,
}

@Injectable()
export class UploadService {
	private readonly logger = new Logger(UploadService.name)

	constructor(@Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider) {}

	// Real image formats we accept and the safe extension we store them under.
	// The extension is derived from the format sharp actually decodes — never from the
	// client-supplied filename or MIME type — so a disguised SVG/HTML cannot be stored.
	private static readonly FORMAT_TO_EXT: Record<string, string> = {
		jpeg: 'jpg',
		png: 'png',
		webp: 'webp',
	}

	// Content type derived from the safe extension above — never the client MIME type.
	private static readonly EXT_TO_MIME: Record<string, string> = {
		jpg: 'image/jpeg',
		png: 'image/png',
		webp: 'image/webp',
	}

	private generateFilename(ext: string): string {
		const timestamp = Date.now()
		const random = Math.random().toString(36).substring(2, 8)
		return `${timestamp}-${random}.${ext}`
	}

	private validateFile(buffer: Buffer, mimeType: string, options: UploadOptions): void {
		const maxSize = options.maxSizeBytes ?? DEFAULT_OPTIONS.maxSizeBytes ?? 5 * 1024 * 1024
		const allowedTypes = options.allowedMimeTypes ?? DEFAULT_OPTIONS.allowedMimeTypes ?? []

		if (buffer.length > maxSize) {
			throw new BadRequestException(
				`Arquivo muito grande. Máximo: ${Math.round(maxSize / 1024 / 1024)}MB`,
			)
		}

		if (!allowedTypes.includes(mimeType)) {
			throw new BadRequestException(
				`Tipo de arquivo não permitido. Permitidos: ${allowedTypes.join(', ')}`,
			)
		}
	}

	async processImage(
		buffer: Buffer,
		options: UploadOptions = {},
	): Promise<{ buffer: Buffer; metadata: sharp.Metadata; ext: string }> {
		const opts = { ...DEFAULT_OPTIONS, ...options }
		const resize = opts.resize ??
			DEFAULT_OPTIONS.resize ?? { width: 1200, height: 1200, fit: 'inside' as const }

		let sharpInstance = sharp(buffer)

		// Trust the format sharp actually decodes, not the client. Reject anything that is
		// not a real raster image we re-encode (e.g. SVG, which can carry script).
		let metadata: sharp.Metadata
		try {
			metadata = await sharpInstance.metadata()
		} catch {
			throw new BadRequestException('Arquivo de imagem inválido')
		}

		const detected = metadata.format === 'jpg' ? 'jpeg' : metadata.format
		if (!detected || !(detected in UploadService.FORMAT_TO_EXT)) {
			throw new BadRequestException('Formato de imagem não suportado. Use JPEG, PNG ou WebP.')
		}

		if (resize.width || resize.height) {
			sharpInstance = sharpInstance.resize({
				width: resize.width,
				height: resize.height,
				fit: resize.fit || 'inside',
				withoutEnlargement: true,
			})
		}

		// Always re-encode to the detected safe format, stripping any embedded payload.
		if (detected === 'jpeg') {
			sharpInstance = sharpInstance.jpeg({ quality: opts.quality || 80 })
		} else if (detected === 'png') {
			sharpInstance = sharpInstance.png({ quality: opts.quality || 80 })
		} else {
			sharpInstance = sharpInstance.webp({ quality: opts.quality || 80 })
		}

		const processedBuffer = await sharpInstance.toBuffer()
		const processedMetadata = await sharp(processedBuffer).metadata()

		return {
			buffer: processedBuffer,
			metadata: processedMetadata,
			ext: UploadService.FORMAT_TO_EXT[detected],
		}
	}

	async uploadProductImage(
		buffer: Buffer,
		originalName: string,
		mimeType: string,
		sellerId: string,
		options: UploadOptions = {},
	): Promise<UploadResult> {
		this.validateFile(buffer, mimeType, options)

		const {
			buffer: processedBuffer,
			metadata,
			ext,
		} = await this.processImage(buffer, {
			...options,
			resize: { width: 800, height: 800, fit: 'inside' },
		})

		const filename = this.generateFilename(ext)
		const key = `products/${sellerId}/${filename}`
		const contentType = UploadService.EXT_TO_MIME[ext]

		const url = await this.storage.save(key, processedBuffer, contentType)

		this.logger.log(`📷 Product image uploaded: ${key}`)

		return {
			filename,
			originalName,
			path: key,
			url,
			size: processedBuffer.length,
			mimeType: contentType,
			width: metadata.width,
			height: metadata.height,
		}
	}

	async uploadProfileImage(
		buffer: Buffer,
		originalName: string,
		mimeType: string,
		userId: string,
		options: UploadOptions = {},
	): Promise<UploadResult> {
		this.validateFile(buffer, mimeType, options)

		const {
			buffer: processedBuffer,
			metadata,
			ext,
		} = await this.processImage(buffer, {
			...options,
			resize: { width: 400, height: 400, fit: 'cover' },
		})

		// Stable key per user; the storage backend overwrites the previous image.
		const filename = `${userId}-profile.${ext}`
		const key = `profiles/${filename}`
		const contentType = UploadService.EXT_TO_MIME[ext]

		const url = await this.storage.save(key, processedBuffer, contentType)

		this.logger.log(`👤 Profile image uploaded: ${key}`)

		return {
			filename,
			originalName,
			path: key,
			url,
			size: processedBuffer.length,
			mimeType: contentType,
			width: metadata.width,
			height: metadata.height,
		}
	}

	async deleteFile(path: string): Promise<boolean> {
		const key = this.safeKey(path)
		if (!key) return false
		return this.storage.delete(key)
	}

	/** Fetch an object's bytes for streaming (e.g. the private avatar proxy). */
	async getObject(path: string) {
		const key = this.safeKey(path)
		if (!key) return null
		return this.storage.getObject(key)
	}

	/** Erase every product image belonging to a seller (account deletion). */
	async deleteSellerProductImages(sellerId: string): Promise<number> {
		return this.storage.deletePrefix(`products/${sellerId}/`)
	}

	// Reject absolute paths and parent-directory traversal before reaching any
	// storage backend — keys must stay within their tenant-scoped namespace.
	private safeKey(path: string): string | null {
		const key = path.replace(/\\/g, '/')
		if (key.startsWith('/') || key.split('/').includes('..')) {
			this.logger.warn(`Rejected unsafe storage key: ${path}`)
			return null
		}
		return key
	}
}
