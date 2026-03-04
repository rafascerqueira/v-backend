import { Injectable } from '@nestjs/common'
import { PrismaService } from '@/shared/prisma/prisma.service'
import type {
	WebhookEventRecord,
	WebhookRepository,
} from '@/shared/repositories/webhook.repository'

@Injectable()
export class PrismaWebhookRepository implements WebhookRepository {
	constructor(private readonly prisma: PrismaService) {}

	async findWebhookEvent(eventId: string): Promise<WebhookEventRecord | null> {
		return this.prisma.webhook_event.findUnique({
			where: { event_id: eventId },
		}) as unknown as WebhookEventRecord | null
	}

	async upsertWebhookEvent(data: {
		event_id: string
		provider: string
		event_type: string
		payload: unknown
	}): Promise<WebhookEventRecord> {
		return this.prisma.webhook_event.upsert({
			where: { event_id: data.event_id },
			update: { retry_count: { increment: 1 } },
			create: {
				provider: data.provider,
				event_id: data.event_id,
				event_type: data.event_type,
				payload: data.payload as any,
			},
		}) as unknown as WebhookEventRecord
	}

	async markWebhookProcessed(id: number): Promise<void> {
		await this.prisma.webhook_event.update({
			where: { id },
			data: { processed: true, processed_at: new Date() },
		})
	}

	async markWebhookError(id: number, error: string): Promise<void> {
		await this.prisma.webhook_event.update({
			where: { id },
			data: { error },
		})
	}

	async findSubscriptionByProviderId(
		providerSubscriptionId: string,
	): Promise<{ id: number; plan_type: string } | null> {
		return this.prisma.subscription.findFirst({
			where: { provider_subscription_id: providerSubscriptionId },
			select: { id: true, plan_type: true },
		}) as unknown as { id: number; plan_type: string } | null
	}

	async updateSubscriptionById(id: number, data: Record<string, unknown>): Promise<void> {
		await this.prisma.subscription.update({
			where: { id },
			data: data as any,
		})
	}

	async updateSubscriptionsByProviderId(
		providerSubscriptionId: string,
		data: Record<string, unknown>,
	): Promise<void> {
		await this.prisma.subscription.updateMany({
			where: { provider_subscription_id: providerSubscriptionId },
			data: data as any,
		})
	}
}
