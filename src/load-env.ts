import { loadEnvFile } from 'node:process'

// Load the .env file as a SIDE EFFECT at import time.
//
// This MUST be the very first import in main.ts. The reason it lives in its own
// module instead of a bare `loadEnvFile()` statement at the top of main.ts:
// TypeScript/SWC hoist ALL `import` statements above any executable statement in
// the file, so a top-of-file `loadEnvFile()` call actually runs AFTER
// `import { AppModule }` — which transitively evaluates `configuration()`
// (ConfigModule) and reads process.env (DATABASE_URL, COOKIE_DOMAIN, …) while the
// .env is still unloaded. That produced production failures: an empty
// DATABASE_URL made every login 401 (no account found), and an undefined
// COOKIE_DOMAIN broke CSRF.
//
// Imports, however, are EVALUATED IN ORDER. By making env-loading a module whose
// side effect is the load, `import './load-env'` placed first guarantees the .env
// is in process.env before any later import runs. Do not convert this back into an
// inline statement in main.ts.
try {
	loadEnvFile()
} catch {
	// No .env on disk (e.g. env injected by the platform) — fall back to ambient env.
}
