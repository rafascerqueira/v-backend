/**
 * Resolve the stored `avatar` value into a URL the client can render.
 *
 * Uploaded avatars are stored as private storage keys (e.g.
 * `profiles/<userId>-profile.jpg`) and are served only through the authenticated
 * proxy route `GET /auth/profile/avatar` — never from a public bucket URL. The
 * proxy URL is stable (it resolves the caller's own key server-side), so a cache
 * buster is appended from `updatedAt` when available.
 *
 * External avatars (e.g. an OAuth provider photo) are stored as absolute URLs and
 * returned as-is.
 */
export function resolveAvatarUrl(
	avatar: string | null | undefined,
	appUrl: string,
	updatedAt?: Date,
): string | null {
	if (!avatar) return null
	if (/^https?:\/\//.test(avatar)) return avatar
	const version = updatedAt ? `?v=${updatedAt.getTime()}` : ''
	return `${appUrl}/auth/profile/avatar${version}`
}
