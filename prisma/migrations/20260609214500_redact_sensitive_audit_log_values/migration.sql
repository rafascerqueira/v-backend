-- The audit interceptor used to store request bodies with an exact-match
-- redaction list that missed keys like "currentPassword" / "newPassword",
-- so plaintext passwords from POST /auth/change-password (and similar
-- endpoints) were persisted into audit_logs. Scrub every existing row:
-- redact any top-level key in old_value / new_value / metadata whose name
-- contains a sensitive fragment (case-insensitive).
DO $$
DECLARE
	col text;
BEGIN
	FOREACH col IN ARRAY ARRAY['old_value', 'new_value', 'metadata'] LOOP
		EXECUTE format(
			$sql$
			UPDATE audit_logs
			SET %1$I = (
				SELECT jsonb_object_agg(
					key,
					CASE
						WHEN key ~* '(password|senha|secret|token|salt|csrf|authorization|otp)'
							THEN '"[REDACTED]"'::jsonb
						ELSE value
					END
				)
				FROM jsonb_each(%1$I)
			)
			WHERE jsonb_typeof(%1$I) = 'object'
				AND %1$I::text != '{}'
				AND EXISTS (
					SELECT 1 FROM jsonb_object_keys(%1$I) AS k
					WHERE k ~* '(password|senha|secret|token|salt|csrf|authorization|otp)'
				)
			$sql$,
			col
		);
	END LOOP;
END $$;
