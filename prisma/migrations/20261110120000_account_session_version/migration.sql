-- Per-account session version (Phase 2A). Session tokens carry the version they were
-- issued under; bumping the column ends every session of the account at once.
-- Additive, with a default, so the code that predates it keeps working.
ALTER TABLE "accounts" ADD COLUMN "session_version" INTEGER NOT NULL DEFAULT 0;
