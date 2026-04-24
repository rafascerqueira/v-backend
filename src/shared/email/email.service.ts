import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createTransport, type Transporter } from 'nodemailer'

export interface SendEmailOptions {
	to: string
	subject: string
	html: string
	text?: string
}

@Injectable()
export class EmailService {
	private readonly logger = new Logger(EmailService.name)
	private transporter: Transporter | null = null
	private readonly smtpFrom: string
	private readonly frontendUrl: string

	constructor(private readonly configService: ConfigService) {
		this.smtpFrom = configService.get<string>('smtp.from', 'noreply@vendinhas.app')
		this.frontendUrl = configService.get<string>('frontendUrl', 'http://localhost:3000')
		this.initializeTransporter()
	}

	private initializeTransporter() {
		const host = this.configService.get<string>('smtp.host')
		const port = this.configService.get<number>('smtp.port', 587)
		const user = this.configService.get<string>('smtp.user')
		const pass = this.configService.get<string>('smtp.pass')

		if (!host) {
			this.logger.warn('📧 SMTP not configured - emails will be logged to console')
			return
		}

		const isLocalhost = host === 'localhost' || host === '127.0.0.1'

		this.transporter = createTransport({
			host,
			port,
			secure: port === 465,
			requireTLS: !isLocalhost && port !== 465,
			...(user && pass ? { auth: { user, pass } } : {}),
			...(isLocalhost ? { tls: { rejectUnauthorized: false } } : {}),
		})

		this.logger.log(
			`📧 SMTP configured: ${host}:${port}${user ? ' (authenticated)' : ' (no auth)'}`,
		)
	}

	async sendEmail(options: SendEmailOptions): Promise<void> {
		if (!this.transporter) {
			this.logger.log(`📧 [DEV] Email to ${options.to}: ${options.subject}`)
			this.logger.log(`   ${options.text ?? options.html.substring(0, 200)}`)
			return
		}

		await this.transporter.sendMail({
			from: `Vendinhas <${this.smtpFrom}>`,
			to: options.to,
			subject: options.subject,
			html: options.html,
			text: options.text,
		})
		this.logger.log(`📧 Email sent to ${options.to}: ${options.subject}`)
	}

	async sendPasswordResetEmail(to: string, token: string, name: string): Promise<void> {
		const resetUrl = `${this.frontendUrl}/reset-password?token=${token}`

		return this.sendEmail({
			to,
			subject: 'Redefinição de Senha - Vendinhas',
			html: `
				<!DOCTYPE html>
				<html>
				<head>
					<meta charset="utf-8">
					<style>
						body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
						.container { max-width: 600px; margin: 0 auto; padding: 20px; }
						.header { background: #6366f1; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
						.content { background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
						.button { display: inline-block; background: #6366f1; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 20px 0; }
						.footer { text-align: center; color: #6b7280; font-size: 12px; margin-top: 20px; }
					</style>
				</head>
				<body>
					<div class="container">
						<div class="header">
							<h1>🔐 Redefinição de Senha</h1>
						</div>
						<div class="content">
							<p>Olá, <strong>${name}</strong>!</p>
							<p>Recebemos uma solicitação para redefinir a senha da sua conta no Vendinhas.</p>
							<p>Clique no botão abaixo para criar uma nova senha:</p>
							<p style="text-align: center;">
								<a href="${resetUrl}" class="button">Redefinir Senha</a>
							</p>
							<p>Ou copie e cole o link abaixo no seu navegador:</p>
							<p style="word-break: break-all; background: #e5e7eb; padding: 10px; border-radius: 4px; font-size: 14px;">${resetUrl}</p>
							<p><strong>Este link expira em 1 hora.</strong></p>
							<p>Se você não solicitou esta redefinição, ignore este email.</p>
						</div>
						<div class="footer">
							<p>© ${new Date().getFullYear()} Vendinhas - Gestão de Vendas</p>
						</div>
					</div>
				</body>
				</html>
			`,
			text: `Olá ${name}, acesse ${resetUrl} para redefinir sua senha. Este link expira em 1 hora.`,
		})
	}

	async sendEmailVerification(to: string, token: string, name: string): Promise<void> {
		const verifyUrl = `${this.frontendUrl}/verify-email?token=${token}`

		return this.sendEmail({
			to,
			subject: 'Confirme seu Email - Vendinhas',
			html: `
				<!DOCTYPE html>
				<html>
				<head>
					<meta charset="utf-8">
					<style>
						body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
						.container { max-width: 600px; margin: 0 auto; padding: 20px; }
						.header { background: #10b981; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
						.content { background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
						.button { display: inline-block; background: #10b981; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 20px 0; }
						.footer { text-align: center; color: #6b7280; font-size: 12px; margin-top: 20px; }
					</style>
				</head>
				<body>
					<div class="container">
						<div class="header">
							<h1>✉️ Confirme seu Email</h1>
						</div>
						<div class="content">
							<p>Olá, <strong>${name}</strong>!</p>
							<p>Bem-vindo ao Vendinhas! Para ativar sua conta, confirme seu endereço de email.</p>
							<p style="text-align: center;">
								<a href="${verifyUrl}" class="button">Confirmar Email</a>
							</p>
							<p>Ou copie e cole o link abaixo no seu navegador:</p>
							<p style="word-break: break-all; background: #e5e7eb; padding: 10px; border-radius: 4px; font-size: 14px;">${verifyUrl}</p>
							<p><strong>Este link expira em 24 horas.</strong></p>
						</div>
						<div class="footer">
							<p>© ${new Date().getFullYear()} Vendinhas - Gestão de Vendas</p>
						</div>
					</div>
				</body>
				</html>
			`,
			text: `Olá ${name}, acesse ${verifyUrl} para confirmar seu email. Este link expira em 24 horas.`,
		})
	}

	async sendWelcomeEmail(to: string, name: string): Promise<void> {
		const loginUrl = `${this.frontendUrl}/login`

		return this.sendEmail({
			to,
			subject: 'Bem-vindo ao Vendinhas! 🎉',
			html: `
				<!DOCTYPE html>
				<html>
				<head>
					<meta charset="utf-8">
					<style>
						body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
						.container { max-width: 600px; margin: 0 auto; padding: 20px; }
						.header { background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
						.content { background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
						.button { display: inline-block; background: #6366f1; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 20px 0; }
						.feature { display: flex; align-items: center; margin: 15px 0; }
						.feature-icon { font-size: 24px; margin-right: 15px; }
						.footer { text-align: center; color: #6b7280; font-size: 12px; margin-top: 20px; }
					</style>
				</head>
				<body>
					<div class="container">
						<div class="header">
							<h1>🎉 Bem-vindo ao Vendinhas!</h1>
							<p>Sua conta foi criada com sucesso</p>
						</div>
						<div class="content">
							<p>Olá, <strong>${name}</strong>!</p>
							<p>Estamos muito felizes em ter você conosco! O Vendinhas é a ferramenta ideal para gerenciar suas vendas.</p>
							
							<h3>O que você pode fazer:</h3>
							<div class="feature">
								<span class="feature-icon">📦</span>
								<span>Cadastrar e gerenciar seus produtos</span>
							</div>
							<div class="feature">
								<span class="feature-icon">👥</span>
								<span>Organizar sua base de clientes</span>
							</div>
							<div class="feature">
								<span class="feature-icon">🛒</span>
								<span>Registrar e acompanhar pedidos</span>
							</div>
							<div class="feature">
								<span class="feature-icon">📊</span>
								<span>Visualizar relatórios de vendas</span>
							</div>

							<p style="text-align: center;">
								<a href="${loginUrl}" class="button">Acessar Minha Conta</a>
							</p>
						</div>
						<div class="footer">
							<p>© ${new Date().getFullYear()} Vendinhas - Gestão de Vendas</p>
						</div>
					</div>
				</body>
				</html>
			`,
			text: `Olá ${name}, bem-vindo ao Vendinhas! Acesse ${loginUrl} para começar.`,
		})
	}
}
