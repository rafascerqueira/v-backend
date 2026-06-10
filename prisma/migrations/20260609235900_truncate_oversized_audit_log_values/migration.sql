-- The audit interceptor stored RAW request bodies with no size limit, so a
-- single mutation with an oversized payload could put multi-megabyte JSONB
-- into audit_logs. A page of 50 such rows pushed the /admin/logs response
-- past V8's maximum string length (JSON.stringify -> RangeError), turning the
-- admin logs page into a permanent 500. The interceptor now caps stored
-- bodies at 8KB; this migration truncates the oversized values already
-- persisted so endpoints that return full values (/audit) stay safe too.
--
-- NOTE: octet_length(value::text), not pg_column_size() — the latter measures
-- the TOAST-compressed size, which lets highly compressible payloads slip
-- under any threshold while still serializing to megabytes in responses.
UPDATE audit_logs
SET old_value = '"[TRUNCATED: oversized]"'::jsonb
WHERE old_value IS NOT NULL AND octet_length(old_value::text) > 65536;

UPDATE audit_logs
SET new_value = '"[TRUNCATED: oversized]"'::jsonb
WHERE new_value IS NOT NULL AND octet_length(new_value::text) > 65536;

UPDATE audit_logs
SET metadata = '"[TRUNCATED: oversized]"'::jsonb
WHERE metadata IS NOT NULL AND octet_length(metadata::text) > 65536;
