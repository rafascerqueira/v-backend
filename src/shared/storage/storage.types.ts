/**
 * Storage abstraction for uploaded binary assets (product/profile images).
 *
 * A concrete provider is selected at runtime by `STORAGE_DRIVER`:
 *  - `local` → {@link LocalStorageProvider} (disk, dev/tests)
 *  - `s3`    → {@link S3StorageProvider} (S3-compatible object store, production)
 *
 * Keys are POSIX-style, forward-slash paths relative to the storage root, e.g.
 * `products/<sellerId>/<file>.jpg` or `profiles/<userId>-profile.png`.
 */
import type { Readable } from 'node:stream'

/** A stored object's bytes plus the metadata needed to serve it. */
export interface StoredObject {
	body: Readable
	contentType?: string
	contentLength?: number
}

export interface StorageProvider {
	/** Persist `buffer` at `key`. Returns the publicly accessible URL. */
	save(key: string, buffer: Buffer, contentType: string): Promise<string>

	/** Delete the object at `key`. Returns true if an object was removed. */
	delete(key: string): Promise<boolean>

	/**
	 * Delete every object under `prefix` (e.g. `products/<sellerId>/`). Used for
	 * erasure. Returns the number of objects removed.
	 */
	deletePrefix(prefix: string): Promise<number>

	/** Fetch an object for streaming, or null if it does not exist. */
	getObject(key: string): Promise<StoredObject | null>

	/** Public URL for an already-stored `key`. */
	getUrl(key: string): string
}

/** DI token for the active {@link StorageProvider}. */
export const STORAGE_PROVIDER = Symbol('STORAGE_PROVIDER')
