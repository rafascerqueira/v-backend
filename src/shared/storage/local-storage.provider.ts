import {
	createReadStream,
	existsSync,
	mkdirSync,
	rmSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { StorageProvider, StoredObject } from './storage.types'

const EXT_TO_MIME: Record<string, string> = {
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	png: 'image/png',
	webp: 'image/webp',
}

/**
 * Disk-backed storage. Used in development and tests. Files are served by
 * `@fastify/static` under the `/uploads/` prefix (registered in `main.ts`).
 *
 * Not suitable for production behind a process manager that re-creates the
 * working directory, or for any containerized/multi-instance deployment —
 * use {@link S3StorageProvider} there.
 */
@Injectable()
export class LocalStorageProvider implements StorageProvider {
	private readonly logger = new Logger(LocalStorageProvider.name)
	private readonly uploadDir: string
	private readonly baseUrl: string

	constructor(configService: ConfigService) {
		this.uploadDir = configService.get<string>('upload.dir') || join(process.cwd(), 'uploads')
		this.baseUrl = configService.get<string>('appUrl', 'http://localhost:3001')
		this.ensureBaseDirs()
	}

	private ensureBaseDirs() {
		for (const dir of ['', 'products', 'profiles', 'temp']) {
			const path = join(this.uploadDir, dir)
			if (!existsSync(path)) {
				mkdirSync(path, { recursive: true })
				this.logger.log(`📁 Created upload directory: ${path}`)
			}
		}
	}

	async save(key: string, buffer: Buffer): Promise<string> {
		const filePath = this.safeResolve(key)
		if (!filePath) {
			throw new Error(`Invalid storage key: ${key}`)
		}
		mkdirSync(dirname(filePath), { recursive: true })
		writeFileSync(filePath, buffer)
		return this.getUrl(key)
	}

	async delete(key: string): Promise<boolean> {
		const filePath = this.safeResolve(key)
		if (!filePath) {
			this.logger.warn(`Path traversal attempt blocked: ${key}`)
			return false
		}
		try {
			if (existsSync(filePath)) {
				unlinkSync(filePath)
				this.logger.log(`File deleted: ${key}`)
				return true
			}
			return false
		} catch (error) {
			this.logger.error(`Failed to delete file: ${key}`, error)
			return false
		}
	}

	async deletePrefix(prefix: string): Promise<number> {
		const dirPath = this.safeResolve(prefix)
		if (!dirPath) {
			this.logger.warn(`Path traversal attempt blocked: ${prefix}`)
			return 0
		}
		if (!existsSync(dirPath)) return 0
		// We don't track an exact count on disk; report 1 when something was removed.
		rmSync(dirPath, { recursive: true, force: true })
		this.logger.log(`Prefix deleted: ${prefix}`)
		return 1
	}

	async getObject(key: string): Promise<StoredObject | null> {
		const filePath = this.safeResolve(key)
		if (!filePath || !existsSync(filePath)) return null
		const ext = key.split('.').pop()?.toLowerCase() ?? ''
		return {
			body: createReadStream(filePath),
			contentType: EXT_TO_MIME[ext],
			contentLength: statSync(filePath).size,
		}
	}

	getUrl(key: string): string {
		return `${this.baseUrl}/uploads/${key}`
	}

	/**
	 * Resolve `key` inside the upload dir, or return null if it escapes it.
	 * Defense-in-depth against path traversal; the UploadService rejects unsafe
	 * keys first, but the storage layer must never write/delete outside its root.
	 */
	private safeResolve(key: string): string | null {
		const full = resolve(join(this.uploadDir, key))
		const base = resolve(this.uploadDir)
		if (full !== base && !full.startsWith(`${base}/`)) {
			return null
		}
		return full
	}
}
