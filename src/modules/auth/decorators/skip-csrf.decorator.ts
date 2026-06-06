import { SetMetadata } from '@nestjs/common'

export const SKIP_CSRF_KEY = 'skipCsrf'

/**
 * Opt a route out of CSRF validation. Use only for endpoints that are NOT
 * authenticated by an ambient browser cookie — e.g. signature-verified webhooks
 * or token-rotation endpoints protected by their own credential.
 */
export const SkipCsrf = () => SetMetadata(SKIP_CSRF_KEY, true)
