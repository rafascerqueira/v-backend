// reflect-metadata MUST load first so decorator type metadata (design:paramtypes)
// is registered before any @Injectable is imported — otherwise Nest can't resolve
// constructor deps and injects `undefined`. The nest build wires this in
// automatically; running standalone (ts-node) does not, so import it explicitly.
// NOTE: this script runs under `ts-node --transpile-only` (see package.json
// avatars:* scripts), NOT tsx — esbuild/tsx does not emit emitDecoratorMetadata,
// which breaks Nest DI here.
import 'reflect-metadata'
import { loadEnvFile } from 'node:process'

// Load .env BEFORE any import that reads process.env at module-load time
// (mirrors src/main.ts — see the cookie-options note in core-rules.md).
try {
	loadEnvFile()
} catch {}

import { Logger } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'

/**
 * Avatar storage remediation — reconcile `account.avatar` against the ACTIVE
 * storage backend (local disk vs. MinIO/S3, selected by STORAGE_DRIVER).
 *
 * Why this exists: when the app moved from local-disk uploads to MinIO, avatars
 * that were never mirrored into the bucket still had their key persisted on the
 * account. The authenticated proxy (`GET /auth/profile/avatar`) then calls
 * `getObject(key)` on the S3 provider, finds nothing, and returns 404 — so those
 * users render a broken <img>. This script finds every account whose stored
 * avatar key does NOT resolve in the current backend and (optionally) clears the
 * dangling reference, letting the SPA fall back to the initials avatar.
 *
 * It uses the REAL DI-wired UploadService, so "does this object exist?" is asked
 * of whatever provider STORAGE_DRIVER selects — no assumptions baked into the
 * script. External OAuth avatars (absolute http(s) URLs) are left untouched.
 *
 * Usage (run from the backend dir, on the server, with prod .env loaded):
 *   pnpm avatars:check    # dry-run: report only, never mutates
 *   pnpm avatars:fix      # clear dangling avatar refs (NULLs the column)
 *
 * Safe to re-run. Dry-run never mutates. With --fix it only ever NULLs avatar
 * columns for keys confirmed missing from storage — it never deletes files.
 */

interface AvatarRow {
	id: string
	email: string
	avatar: string | null
	updatedAt: Date
}

const isExternal = (avatar: string) => /^https?:\/\//.test(avatar)

async function main() {
	const fix = process.argv.includes('--fix')
	const logger = new Logger('remediate-avatars')

	logger.log(
		`STORAGE_DRIVER=${process.env.STORAGE_DRIVER ?? 'local'} | mode=${fix ? 'FIX' : 'DRY-RUN'}`,
	)

	// Import AppModule (and everything it pulls in, incl. ConfigModule's
	// `configuration()`) only AFTER loadEnvFile() above has run. A static top-level
	// import would be hoisted ABOVE loadEnvFile() and evaluate configuration with an
	// unloaded .env — the very ordering trap documented in core-rules.md.
	const { AppModule } = await import('../src/app.module')
	const { PrismaService } = await import('../src/shared/prisma/prisma.service')
	const { UploadService } = await import('../src/shared/upload/upload.service')

	const app = await NestFactory.createApplicationContext(AppModule, {
		logger: ['warn', 'error'],
	})

	try {
		const prisma = app.get(PrismaService)
		const uploadService = app.get(UploadService)

		const accounts: AvatarRow[] = await prisma.account.findMany({
			where: { avatar: { not: null } },
			select: { id: true, email: true, avatar: true, updatedAt: true },
		})

		logger.log(`Found ${accounts.length} account(s) with an avatar set.`)

		let external = 0
		let ok = 0
		const orphans: AvatarRow[] = []

		for (const account of accounts) {
			const avatar = account.avatar
			if (!avatar) continue

			if (isExternal(avatar)) {
				external++
				continue
			}

			// Ask the ACTIVE storage backend whether the object actually exists.
			const object = await uploadService.getObject(avatar)
			if (object) {
				ok++
				// getObject may open a read stream (local provider) — close it so we
				// don't leak descriptors while iterating thousands of rows.
				object.body.destroy?.()
			} else {
				orphans.push(account)
			}
		}

		logger.log('─'.repeat(60))
		logger.log(`✅ resolved OK:        ${ok}`)
		logger.log(`🔗 external (skipped): ${external}`)
		logger.log(`❌ dangling (missing): ${orphans.length}`)

		for (const o of orphans) {
			logger.warn(`   dangling → account=${o.id} email=${o.email} key=${o.avatar}`)
		}

		if (orphans.length === 0) {
			logger.log('Nothing to remediate. 🎉')
			return
		}

		if (!fix) {
			logger.log('─'.repeat(60))
			logger.log(`DRY-RUN: re-run with --fix to NULL these ${orphans.length} avatar reference(s).`)
			return
		}

		const ids = orphans.map((o) => o.id)
		const { count } = await prisma.account.updateMany({
			where: { id: { in: ids } },
			data: { avatar: null },
		})
		logger.log('─'.repeat(60))
		logger.log(
			`🔧 Cleared ${count} dangling avatar reference(s). Those users now render the initials avatar.`,
		)
	} finally {
		await app.close()
	}
}

main().catch((err) => {
	// eslint-disable-next-line no-console
	console.error('remediate-avatars failed:', err)
	process.exit(1)
})
