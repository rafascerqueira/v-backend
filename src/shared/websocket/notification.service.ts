import { Injectable, Logger } from "@nestjs/common";
import { EmailService } from "@/shared/email/email.service";
import { PrismaService } from "@/shared/prisma/prisma.service";
import {
	NotificationsGateway,
	type Notification,
} from "./notifications.gateway";

export type NotificationType = "info" | "success" | "warning" | "error";

export interface CreateNotificationOptions {
	userId: string;
	type: NotificationType;
	title: string;
	message: string;
	data?: Record<string, unknown>;
	sendEmail?: boolean;
	emailSubject?: string;
}

@Injectable()
export class NotificationService {
	private readonly logger = new Logger(NotificationService.name);

	constructor(
		private readonly prisma: PrismaService,
		private readonly gateway: NotificationsGateway,
		private readonly emailService: EmailService,
	) {}

	async create(options: CreateNotificationOptions): Promise<Notification> {
		const notification = await this.prisma.notification.create({
			data: {
				user_id: options.userId,
				type: options.type,
				title: options.title,
				message: options.message,
				data: options.data
					? JSON.parse(JSON.stringify(options.data))
					: undefined,
				email_sent: false,
			},
		});

		const wsNotification: Notification = {
			id: `notif-${notification.id}`,
			type: options.type,
			title: options.title,
			message: options.message,
			timestamp: notification.createdAt,
			read: false,
			data: options.data,
		};

		// Send via WebSocket
		this.gateway.sendToUser(options.userId, wsNotification);

		// Send email if requested
		if (options.sendEmail) {
			this.sendEmailNotification(options.userId, notification.id, options);
		}

		return wsNotification;
	}

	private async sendEmailNotification(
		userId: string,
		notificationId: number,
		options: CreateNotificationOptions,
	) {
		try {
			const user = await this.prisma.account.findUnique({
				where: { id: userId },
				select: { email: true, name: true },
			});

			if (!user) return;

			await this.emailService.sendEmail({
				to: user.email,
				subject: options.emailSubject || options.title,
				html: this.buildEmailHtml(options, user.name),
				text: options.message,
			});

			await this.prisma.notification.update({
				where: { id: notificationId },
				data: { email_sent: true },
			});

			this.logger.log(`📧 Email notification sent to ${user.email}`);
		} catch (error) {
			this.logger.error(`Failed to send email notification: ${error}`);
		}
	}

	private buildEmailHtml(
		options: CreateNotificationOptions,
		userName: string,
	): string {
		const typeColors: Record<NotificationType, string> = {
			info: "#3b82f6",
			success: "#10b981",
			warning: "#f59e0b",
			error: "#ef4444",
		};

		const typeIcons: Record<NotificationType, string> = {
			info: "ℹ️",
			success: "✅",
			warning: "⚠️",
			error: "❌",
		};

		return `
			<!DOCTYPE html>
			<html>
			<head>
				<meta charset="utf-8">
				<style>
					body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
					.container { max-width: 600px; margin: 0 auto; padding: 20px; }
					.header { background: ${typeColors[options.type]}; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
					.content { background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
					.footer { text-align: center; color: #6b7280; font-size: 12px; margin-top: 20px; }
				</style>
			</head>
			<body>
				<div class="container">
					<div class="header">
						<h1>${typeIcons[options.type]} ${options.title}</h1>
					</div>
					<div class="content">
						<p>Olá, <strong>${userName}</strong>!</p>
						<p>${options.message}</p>
					</div>
					<div class="footer">
						<p>© ${new Date().getFullYear()} Vendinhas - Gestão de Vendas</p>
					</div>
				</div>
			</body>
			</html>
		`;
	}

	async getUnreadCount(userId: string): Promise<number> {
		return this.prisma.notification.count({
			where: { user_id: userId, read: false },
		});
	}

	async getAll(userId: string, limit = 50): Promise<Notification[]> {
		const notifications = await this.prisma.notification.findMany({
			where: { user_id: userId },
			orderBy: { createdAt: "desc" },
			take: limit,
		});

		return notifications.map((n) => ({
			id: `notif-${n.id}`,
			type: n.type as NotificationType,
			title: n.title,
			message: n.message,
			timestamp: n.createdAt,
			read: n.read,
			data: n.data as Record<string, unknown>,
		}));
	}

	async markAsRead(userId: string, notificationId: string): Promise<void> {
		const id = parseInt(notificationId.replace("notif-", ""), 10);
		if (isNaN(id)) return;

		await this.prisma.notification.updateMany({
			where: { id, user_id: userId },
			data: { read: true, read_at: new Date() },
		});
	}

	async markAllAsRead(userId: string): Promise<void> {
		await this.prisma.notification.updateMany({
			where: { user_id: userId, read: false },
			data: { read: true, read_at: new Date() },
		});
	}

	// Helper methods for common notifications
	async notifyNewOrder(userId: string, orderNumber: string, total: number) {
		return this.create({
			userId,
			type: "success",
			title: "Novo Pedido Recebido",
			message: `Pedido ${orderNumber} no valor de R$ ${(total / 100).toFixed(2)} foi criado.`,
			data: { orderNumber, total },
			sendEmail: true,
		});
	}

	async notifyLowStock(userId: string, productName: string, quantity: number) {
		return this.create({
			userId,
			type: "warning",
			title: "Estoque Baixo",
			message: `O produto "${productName}" está com apenas ${quantity} unidades em estoque.`,
			data: { productName, quantity },
			sendEmail: true,
		});
	}

	async notifyPaymentReceived(
		userId: string,
		orderNumber: string,
		amount: number,
	) {
		return this.create({
			userId,
			type: "success",
			title: "Pagamento Confirmado",
			message: `Pagamento de R$ ${(amount / 100).toFixed(2)} confirmado para o pedido ${orderNumber}.`,
			data: { orderNumber, amount },
			sendEmail: true,
		});
	}

	async notifySubscriptionExpiring(userId: string, daysLeft: number) {
		return this.create({
			userId,
			type: "warning",
			title: "Assinatura Expirando",
			message: `Sua assinatura Pro expira em ${daysLeft} dias. Renove para manter os benefícios.`,
			data: { daysLeft },
			sendEmail: true,
			emailSubject: "Sua assinatura Vendinhas está expirando",
		});
	}
}
