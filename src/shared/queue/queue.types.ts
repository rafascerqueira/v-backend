// ─── Email ───────────────────────────────────────────────────────────────────

export interface SendEmailJobData {
	to: string
	subject: string
	html: string
	text?: string
}

export interface PasswordResetEmailJobData {
	to: string
	name: string
	token: string
}

export interface VerifyEmailJobData {
	to: string
	name: string
	token: string
}

export interface WelcomeEmailJobData {
	to: string
	name: string
}

// ─── Notification ─────────────────────────────────────────────────────────────

export interface NotificationJobData {
	userId: string
	type: 'info' | 'success' | 'warning' | 'error'
	title: string
	message: string
	data?: Record<string, unknown>
	sendEmail?: boolean
	emailSubject?: string
}

// ─── PDF ──────────────────────────────────────────────────────────────────────

export interface PdfJobData {
	type: string
	data: Record<string, unknown>
	outputPath: string
	sellerId?: string
}

// ─── Image ────────────────────────────────────────────────────────────────────

export interface ImageJobData {
	inputPath: string
	outputPath: string
	width?: number
	height?: number
	quality?: number
}

// ─── Excel ────────────────────────────────────────────────────────────────────

export interface ExcelJobData {
	type: string
	data: Record<string, unknown>[]
	outputPath: string
	sellerId?: string
}

// ─── Dead Letter ──────────────────────────────────────────────────────────────

export interface DeadLetterJobData {
	originalQueue: string
	originalJobId: string
	originalJobName: string
	originalData: unknown
	failedReason: string
	failedAt: string // ISO date string
	attemptsMade: number
}
