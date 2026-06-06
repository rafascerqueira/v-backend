import type { Readable } from 'node:stream'
import {
	DeleteObjectCommand,
	DeleteObjectsCommand,
	GetObjectCommand,
	ListObjectsV2Command,
	PutObjectCommand,
	S3Client,
} from '@aws-sdk/client-s3'
import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { StorageProvider, StoredObject } from './storage.types'

interface S3Config {
	bucket?: string
	region: string
	endpoint?: string
	accessKeyId?: string
	secretAccessKey?: string
	forcePathStyle: boolean
	publicUrl?: string
}

/**
 * S3-compatible object storage (AWS S3, MinIO, Cloudflare R2, …).
 *
 * Objects are stored under tenant-scoped keys and served from a public base
 * URL (CDN or public bucket endpoint) configured via STORAGE_S3_PUBLIC_URL.
 * Because the API may run behind multiple instances or on ephemeral
 * filesystems, this is the production-safe backend for uploads.
 */
@Injectable()
export class S3StorageProvider implements StorageProvider {
	private readonly logger = new Logger(S3StorageProvider.name)
	private readonly client: S3Client
	private readonly bucket: string
	private readonly publicUrl: string

	constructor(configService: ConfigService) {
		const cfg = configService.get<S3Config>('storage.s3')
		if (!cfg?.bucket) {
			throw new Error('STORAGE_S3_BUCKET is required when STORAGE_DRIVER=s3')
		}

		this.bucket = cfg.bucket
		this.publicUrl = this.resolvePublicUrl(cfg)
		this.client = new S3Client({
			region: cfg.region,
			endpoint: cfg.endpoint,
			forcePathStyle: cfg.forcePathStyle,
			// Fall back to the default AWS credential chain (IAM role, env, profile)
			// when explicit keys are not provided.
			credentials:
				cfg.accessKeyId && cfg.secretAccessKey
					? { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey }
					: undefined,
		})
		this.logger.log(`🗄️ S3 storage ready (bucket: ${this.bucket}, base: ${this.publicUrl})`)
	}

	async save(key: string, buffer: Buffer, contentType: string): Promise<string> {
		await this.client.send(
			new PutObjectCommand({
				Bucket: this.bucket,
				Key: key,
				Body: buffer,
				ContentType: contentType,
				// Re-encoded immutable assets (unique product keys / overwritten
				// profile keys) — cache aggressively at the CDN/edge.
				CacheControl: 'public, max-age=31536000, immutable',
			}),
		)
		this.logger.log(`📤 Uploaded to S3: ${key}`)
		return this.getUrl(key)
	}

	async delete(key: string): Promise<boolean> {
		try {
			await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }))
			this.logger.log(`🗑️ Deleted from S3: ${key}`)
			return true
		} catch (error) {
			this.logger.error(`Failed to delete S3 object: ${key}`, error)
			return false
		}
	}

	async deletePrefix(prefix: string): Promise<number> {
		let removed = 0
		let continuationToken: string | undefined

		do {
			const listed = await this.client.send(
				new ListObjectsV2Command({
					Bucket: this.bucket,
					Prefix: prefix,
					ContinuationToken: continuationToken,
				}),
			)
			const objects = (listed.Contents ?? [])
				.map((o) => o.Key)
				.filter((k): k is string => Boolean(k))

			if (objects.length > 0) {
				await this.client.send(
					new DeleteObjectsCommand({
						Bucket: this.bucket,
						Delete: { Objects: objects.map((Key) => ({ Key })), Quiet: true },
					}),
				)
				removed += objects.length
			}
			continuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined
		} while (continuationToken)

		if (removed > 0) this.logger.log(`🗑️ Deleted ${removed} object(s) under prefix: ${prefix}`)
		return removed
	}

	async getObject(key: string): Promise<StoredObject | null> {
		try {
			const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }))
			if (!res.Body) return null
			return {
				body: res.Body as Readable,
				contentType: res.ContentType,
				contentLength: res.ContentLength,
			}
		} catch (error) {
			if ((error as { name?: string }).name === 'NoSuchKey') return null
			this.logger.error(`Failed to read S3 object: ${key}`, error)
			return null
		}
	}

	getUrl(key: string): string {
		return `${this.publicUrl}/${key}`
	}

	private resolvePublicUrl(cfg: S3Config): string {
		if (cfg.publicUrl) {
			return cfg.publicUrl.replace(/\/+$/, '')
		}
		// Derive a sensible default. Path-style (MinIO/R2) appends the bucket to
		// the endpoint; AWS virtual-hosted style uses the regional S3 host.
		if (cfg.endpoint) {
			const base = cfg.endpoint.replace(/\/+$/, '')
			return cfg.forcePathStyle ? `${base}/${cfg.bucket}` : base
		}
		return `https://${cfg.bucket}.s3.${cfg.region}.amazonaws.com`
	}
}
