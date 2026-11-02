export const QUEUE_NAMES = {
	EMAIL: 'email',
	NOTIFICATION: 'notification',
	PDF: 'pdf',
	IMAGE: 'image',
	EXCEL: 'excel',
	SUBSCRIPTION: 'subscription',
	DEAD_LETTER: 'dead-letter',
	// Outbox relay (scheduled + kicked) and the idempotency-key purge.
	OUTBOX: 'outbox',
	// One job per (domain event, handler), enqueued by the outbox relay.
	DOMAIN_EFFECTS: 'domain-effects',
} as const

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES]

export const SUBSCRIPTION_JOBS = {
	RECONCILE: 'reconcile',
} as const

export const OUTBOX_JOBS = {
	RELAY: 'relay',
	PURGE_IDEMPOTENCY_KEYS: 'purge-idempotency-keys',
} as const

export const EMAIL_JOBS = {
	SEND: 'send',
	PASSWORD_RESET: 'password-reset',
	VERIFY_EMAIL: 'verify-email',
	WELCOME: 'welcome',
} as const

export const IMAGE_JOBS = {
	RESIZE: 'resize',
	COMPRESS: 'compress',
	THUMBNAIL: 'thumbnail',
} as const
