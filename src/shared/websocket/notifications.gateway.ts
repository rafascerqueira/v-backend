import { Injectable, Logger } from '@nestjs/common'
import {
	ConnectedSocket,
	MessageBody,
	type OnGatewayConnection,
	type OnGatewayDisconnect,
	SubscribeMessage,
	WebSocketGateway,
	WebSocketServer,
} from '@nestjs/websockets'
import type { Server, Socket } from 'socket.io'
import configuration from '@/config/configuration'
import { SessionService } from '@/modules/auth/services/session.service'
import { isOriginAllowed } from '@/shared/security/allowed-origins'

export interface Notification {
	id: string
	type: 'info' | 'success' | 'warning' | 'error'
	title: string
	message: string
	timestamp: Date
	read: boolean
	data?: Record<string, unknown>
}

// Origin settings are read on each handshake (not at import time), so a late-loaded
// .env is honoured. Same list as CORS and the login/refresh Origin check.
function handshakeOriginAllowed(origin: string | undefined): boolean {
	if (!origin) return true
	const config = configuration()
	return isOriginAllowed(origin, {
		corsOrigin: config.cors.origin,
		frontendUrl: config.frontendUrl,
		apiUrl: config.appUrl,
		isProduction: config.isProduction,
	})
}

@Injectable()
@WebSocketGateway({
	cors: {
		origin: (origin: string, callback: (err: Error | null, allow?: boolean) => void) => {
			callback(null, handshakeOriginAllowed(origin))
		},
		credentials: true,
	},
	namespace: '/notifications',
})
export class NotificationsGateway implements OnGatewayConnection, OnGatewayDisconnect {
	private readonly logger = new Logger(NotificationsGateway.name)

	constructor(private readonly sessionService: SessionService) {}

	@WebSocketServer()
	server!: Server

	private connectedUsers = new Map<string, string[]>()

	async handleConnection(client: Socket) {
		const token = client.handshake.auth?.token || (client.handshake.query.token as string)

		if (!token) {
			this.logger.warn(`[WS] Connection rejected: no token (${client.id})`)
			client.disconnect()
			return
		}

		try {
			// Same check as an HTTP request: live session, active account, current version.
			const user = await this.sessionService.authenticate(token)
			const userId = user.sub

			;(client as any).userId = userId
			const existing = this.connectedUsers.get(userId) || []
			this.connectedUsers.set(userId, [...existing, client.id])
			client.join(`user:${userId}`)
			this.logger.log(`[WS] User ${userId} connected (${client.id})`)
		} catch {
			this.logger.warn(`[WS] Connection rejected: invalid token (${client.id})`)
			client.disconnect()
		}
	}

	handleDisconnect(client: Socket) {
		const userId = (client as any).userId as string
		if (userId) {
			const sockets = this.connectedUsers.get(userId) || []
			const filtered = sockets.filter((id) => id !== client.id)
			if (filtered.length === 0) {
				this.connectedUsers.delete(userId)
			} else {
				this.connectedUsers.set(userId, filtered)
			}
			this.logger.log(`[WS] User ${userId} disconnected (${client.id})`)
		}
	}

	@SubscribeMessage('markAsRead')
	handleMarkAsRead(@ConnectedSocket() client: Socket, @MessageBody() notificationId: string) {
		const userId = (client as any).userId as string
		this.server.to(`user:${userId}`).emit('notificationRead', notificationId)
		return { success: true }
	}

	sendToUser(userId: string, notification: Notification) {
		this.server.to(`user:${userId}`).emit('notification', notification)
	}

	sendToAll(notification: Notification) {
		this.server.emit('notification', notification)
	}

	sendOrderUpdate(userId: string, orderId: number, status: string) {
		const notification: Notification = {
			id: `order-${orderId}-${Date.now()}`,
			type: 'info',
			title: 'Pedido Atualizado',
			message: `O pedido #${orderId} foi atualizado para: ${status}`,
			timestamp: new Date(),
			read: false,
			data: { orderId, status },
		}
		this.sendToUser(userId, notification)
	}

	sendLowStockAlert(userId: string, productName: string, quantity: number) {
		const notification: Notification = {
			id: `stock-${Date.now()}`,
			type: 'warning',
			title: 'Estoque Baixo',
			message: `${productName} está com estoque baixo (${quantity} unidades)`,
			timestamp: new Date(),
			read: false,
			data: { productName, quantity },
		}
		this.sendToUser(userId, notification)
	}

	sendPaymentReceived(userId: string, amount: number, orderId: number) {
		const notification: Notification = {
			id: `payment-${orderId}-${Date.now()}`,
			type: 'success',
			title: 'Pagamento Recebido',
			message: `Pagamento de R$ ${(amount / 100).toFixed(2)} recebido para o pedido #${orderId}`,
			timestamp: new Date(),
			read: false,
			data: { amount, orderId },
		}
		this.sendToUser(userId, notification)
	}
}
