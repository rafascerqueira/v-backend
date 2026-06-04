import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { BadRequestException, Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
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
	private readonly uploadDir: string
	private readonly baseUrl: string

	constructor(readonly configService: ConfigService) {
		this.uploadDir = configService.get<string>('upload.dir') || join(process.cwd(), 'uploads')
		this.baseUrl = configService.get<string>('appUrl', 'http://localhost:3001')
		this.ensureUploadDir()
	}

	private ensureUploadDir() {
		const dirs = ['', 'products', 'profiles', 'temp']
		for (const dir of dirs) {
			const path = join(this.uploadDir, dir)
			if (!existsSync(path)) {
				mkdirSync(path, { recursive: true })
				this.logger.log(`📁 Created upload directory: ${path}`)
			}
		}
	}

	// Real image formats we accept and the safe extension we store them under.
	// The extension is derived from the format sharp actually decodes — never from the
	// client-supplied filename or MIME type — so a disguised SVG/HTML cannot be stored.
	private static readonly FORMAT_TO_EXT: Record<string, string> = {
		jpeg: 'jpg',
		png: 'png',
		webp: 'webp',
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
		const subDir = join('products', sellerId)
		const dirPath = join(this.uploadDir, subDir)

		if (!existsSync(dirPath)) {
			mkdirSync(dirPath, { recursive: true })
		}

		const filePath = join(dirPath, filename)
		writeFileSync(filePath, processedBuffer)

		this.logger.log(`📷 Product image uploaded: ${filename}`)

		return {
			filename,
			originalName,
			path: join(subDir, filename),
			url: `${this.baseUrl}/uploads/${subDir}/${filename}`,
			size: processedBuffer.length,
			mimeType,
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

		const filename = `${userId}-profile.${ext}`
		const subDir = 'profiles'
		const dirPath = join(this.uploadDir, subDir)

		if (!existsSync(dirPath)) {
			mkdirSync(dirPath, { recursive: true })
		}

		const filePath = join(dirPath, filename)

		// Remove old profile image if exists
		if (existsSync(filePath)) {
			unlinkSync(filePath)
		}

		writeFileSync(filePath, processedBuffer)

		this.logger.log(`👤 Profile image uploaded: ${filename}`)

		return {
			filename,
			originalName,
			path: join(subDir, filename),
			url: `${this.baseUrl}/uploads/${subDir}/${filename}`,
			size: processedBuffer.length,
			mimeType,
			width: metadata.width,
			height: metadata.height,
		}
	}

	async deleteFile(path: string): Promise<boolean> {
		try {
			const fullPath = join(this.uploadDir, path)
			const resolved = resolve(fullPath)
			const resolvedUploadDir = resolve(this.uploadDir)

			if (!resolved.startsWith(`${resolvedUploadDir}/`)) {
				this.logger.warn(`Path traversal attempt blocked: ${path}`)
				return false
			}

			if (existsSync(fullPath)) {
				unlinkSync(fullPath)
				this.logger.log(`File deleted: ${path}`)
				return true
			}
			return false
		} catch (error) {
			this.logger.error(`Failed to delete file: ${path}`, error)
			return false
		}
	}

	getUploadDir(): string {
		return this.uploadDir
	}
}
