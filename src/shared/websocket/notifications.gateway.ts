import { Injectable } from '@nestjs/common'
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

export interface Notification {
	id: string
	type: 'info' | 'success' | 'warning' | 'error'
	title: string
	message: string
	timestamp: Date
	read: boolean
	data?: Record<string, unknown>
}

@Injectable()
@WebSocketGateway({
	cors: {
		origin: (origin: string, callback: (err: Error | null, allow?: boolean) => void) => {
			const allowedOrigins = [
				process.env.FRONTEND_URL || 'http://localhost:3000',
				'http://127.0.0.1:3000',
			]
			const isAllowed =
				!origin || allowedOrigins.includes(origin) || /^http:\/\/127\.0\.0\.1:\d+$/.test(origin)
			callback(null, isAllowed)
		},
		credentials: true,
	},
	namespace: '/notifications',
})
export class NotificationsGateway implements OnGatewayConnection, OnGatewayDisconnect {
	@WebSocketServer()
	server!: Server

	private connectedUsers = new Map<string, string[]>()

	handleConnection(client: Socket) {
		const userId = client.handshake.query.userId as string
		if (userId) {
			const existing = this.connectedUsers.get(userId) || []
			this.connectedUsers.set(userId, [...existing, client.id])
			client.join(`user:${userId}`)
			console.log(`[WS] User ${userId} connected (${client.id})`)
		}
	}

	handleDisconnect(client: Socket) {
		const userId = client.handshake.query.userId as string
		if (userId) {
			const sockets = this.connectedUsers.get(userId) || []
			const filtered = sockets.filter((id) => id !== client.id)
			if (filtered.length === 0) {
				this.connectedUsers.delete(userId)
			} else {
				this.connectedUsers.set(userId, filtered)
			}
			console.log(`[WS] User ${userId} disconnected (${client.id})`)
		}
	}

	@SubscribeMessage('markAsRead')
	handleMarkAsRead(@ConnectedSocket() client: Socket, @MessageBody() notificationId: string) {
		const userId = client.handshake.query.userId as string
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

	sendLowStockAlert(productName: string, quantity: number) {
		const notification: Notification = {
			id: `stock-${Date.now()}`,
			type: 'warning',
			title: 'Estoque Baixo',
			message: `${productName} está com estoque baixo (${quantity} unidades)`,
			timestamp: new Date(),
			read: false,
			data: { productName, quantity },
		}
		this.sendToAll(notification)
	}

	sendPaymentReceived(userId: string, amount: number, orderId: number) {
		const notification: Notification = {
			id: `payment-${orderId}-${Date.now()}`,
			type: 'success',
			title: 'Pagamento Recebido',
			message: `Pagamento de R$ ${amount.toFixed(2)} recebido para o pedido #${orderId}`,
			timestamp: new Date(),
			read: false,
			data: { amount, orderId },
		}
		this.sendToUser(userId, notification)
	}
}
