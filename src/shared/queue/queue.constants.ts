export const QUEUE_NAMES = {
	EMAIL: 'email',
	NOTIFICATION: 'notification',
	PDF: 'pdf',
	IMAGE: 'image',
	EXCEL: 'excel',
	DEAD_LETTER: 'dead-letter',
} as const

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES]

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
