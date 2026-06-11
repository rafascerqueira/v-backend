/**
 * EmailService unit tests
 *
 * Focus:
 *   1. The no-SMTP fallback does NOT crash and does NOT pretend to have sent
 *      (it logs and returns). This matters because EmailService is called by
 *      queue processors that retry on throw — a thrown error in dev would loop
 *      forever in the DLQ.
 *   2. The sendMail envelope (from, to, subject) is built correctly.
 *   3. Token-bearing URLs (password reset, email verify) include the token AND
 *      target the right frontend route. A typo here = users locked out.
 */
import { ConfigService } from '@nestjs/config'

const sendMailMock = jest.fn().mockResolvedValue({ messageId: 'mid-1' })
const createTransportMock: jest.Mock = jest.fn(() => ({ sendMail: sendMailMock }))

jest.mock('nodemailer', () => ({
	createTransport: (opts: unknown) => createTransportMock(opts),
}))

import { EmailService } from './email.service'

function makeConfig(overrides: Record<string, unknown> = {}) {
	const base: Record<string, unknown> = {
		'smtp.host': 'smtp.example.com',
		'smtp.port': 587,
		'smtp.user': 'mailer',
		'smtp.pass': 'sekret',
		'smtp.from': 'noreply@vendinhas.app',
		frontendUrl: 'https://app.vendinhas.com',
		...overrides,
	}
	return {
		get: jest.fn((key: string, fallback?: unknown) => {
			const value = base[key]
			return value === undefined ? fallback : value
		}),
	} as unknown as ConfigService
}

describe('EmailService', () => {
	beforeEach(() => {
		jest.clearAllMocks()
	})

	describe('initialization', () => {
		it('skips transporter creation when SMTP host is not configured', () => {
			new EmailService(makeConfig({ 'smtp.host': undefined }))
			expect(createTransportMock).not.toHaveBeenCalled()
		})

		it('creates a transporter when SMTP host is set', () => {
			new EmailService(makeConfig())
			expect(createTransportMock).toHaveBeenCalledTimes(1)
		})

		it('uses secure=true when port is 465 (implicit TLS)', () => {
			new EmailService(makeConfig({ 'smtp.port': 465 }))
			expect(createTransportMock).toHaveBeenCalledWith(
				expect.objectContaining({ port: 465, secure: true }),
			)
		})

		it('requires TLS for remote hosts on port 587 (STARTTLS)', () => {
			new EmailService(makeConfig({ 'smtp.host': 'smtp.example.com', 'smtp.port': 587 }))
			expect(createTransportMock).toHaveBeenCalledWith(
				expect.objectContaining({ requireTLS: true }),
			)
		})

		it('relaxes TLS for localhost (dev convenience, never enables auth implicitly)', () => {
			new EmailService(
				makeConfig({
					'smtp.host': 'localhost',
					'smtp.port': 1025,
					'smtp.user': undefined,
					'smtp.pass': undefined,
				}),
			)
			expect(createTransportMock).toHaveBeenCalledWith(
				expect.objectContaining({
					requireTLS: false,
					tls: { rejectUnauthorized: false },
				}),
			)
			// Auth must NOT be set when user/pass are absent
			const opts = createTransportMock.mock.calls[0][0] as Record<string, unknown>
			expect(opts).not.toHaveProperty('auth')
		})
	})

	describe('sendEmail (no SMTP)', () => {
		it('returns silently instead of throwing when SMTP is not configured', async () => {
			const svc = new EmailService(makeConfig({ 'smtp.host': undefined }))

			await expect(
				svc.sendEmail({ to: 'a@b.com', subject: 'Hi', html: '<p>Hello</p>' }),
			).resolves.toBeUndefined()
		})
	})

	describe('sendEmail (with SMTP)', () => {
		it('sends with the configured "from" wrapped in display name', async () => {
			const svc = new EmailService(makeConfig({ 'smtp.from': 'mail@vendinhas.app' }))

			await svc.sendEmail({ to: 'a@b.com', subject: 'Hi', html: '<p>x</p>', text: 'x' })

			expect(sendMailMock).toHaveBeenCalledWith(
				expect.objectContaining({
					from: 'Vendinhas <mail@vendinhas.app>',
					to: 'a@b.com',
					subject: 'Hi',
					html: '<p>x</p>',
					text: 'x',
				}),
			)
		})

		it('falls back to the default "from" when smtp.from is not set', async () => {
			const svc = new EmailService(makeConfig({ 'smtp.from': undefined }))

			await svc.sendEmail({ to: 'a@b.com', subject: 'Hi', html: '<p>x</p>' })

			expect(sendMailMock.mock.calls[0][0].from).toBe('Vendinhas <noreply@vendinhas.app>')
		})
	})

	describe('sendPasswordResetEmail', () => {
		it('builds the reset URL with the token and frontend base', async () => {
			const svc = new EmailService(makeConfig({ frontendUrl: 'https://app.example.com' }))

			await svc.sendPasswordResetEmail('user@x.com', 'tok-abc123', 'Alice')

			const envelope = sendMailMock.mock.calls[0][0]
			expect(envelope.to).toBe('user@x.com')
			expect(envelope.subject).toMatch(/Redefini/)
			expect(envelope.html).toContain('https://app.example.com/reset-password?token=tok-abc123')
			expect(envelope.text).toContain('https://app.example.com/reset-password?token=tok-abc123')
			expect(envelope.html).toContain('Alice')
		})
	})

	describe('sendEmailVerification', () => {
		it('builds the verify URL with the token and goes to /verify-email', async () => {
			const svc = new EmailService(makeConfig({ frontendUrl: 'https://app.example.com' }))

			await svc.sendEmailVerification('user@x.com', 'verify-xyz', 'Bob')

			const envelope = sendMailMock.mock.calls[0][0]
			expect(envelope.html).toContain('https://app.example.com/verify-email?token=verify-xyz')
			expect(envelope.text).toContain('https://app.example.com/verify-email?token=verify-xyz')
			expect(envelope.html).toContain('Bob')
		})
	})

	describe('sendWelcomeEmail', () => {
		it('includes the login URL', async () => {
			const svc = new EmailService(makeConfig({ frontendUrl: 'https://app.example.com' }))

			await svc.sendWelcomeEmail('user@x.com', 'Carol')

			const envelope = sendMailMock.mock.calls[0][0]
			expect(envelope.html).toContain('https://app.example.com/login')
			expect(envelope.text).toContain('https://app.example.com/login')
			expect(envelope.html).toContain('Carol')
		})
	})
})
