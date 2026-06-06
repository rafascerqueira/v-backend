-- Profile pictures are now PRIVATE: `avatar` stores a storage key, not a public URL.
-- Convert any existing legacy public avatar URL to its bare storage key so it is
-- served through the authenticated proxy (GET /auth/profile/avatar).
--
--   Old: https://api.vendinhas.app/uploads/profiles/<id>-profile.<ext>  (and dev variants)
--   New: profiles/<id>-profile.<ext>
--
-- External (OAuth) avatars and already-converted keys are left untouched.
UPDATE "accounts"
SET "avatar" = substring("avatar" from 'profiles/[^?]+')
WHERE "avatar" LIKE 'http%'
  AND "avatar" LIKE '%/profiles/%';
