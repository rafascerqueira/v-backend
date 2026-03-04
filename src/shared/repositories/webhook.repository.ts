export interface WebhookEventRecord {
	id: number
	provider: string
	event_id: string
	event_type: string
	payload: unknown
	processed: boolean
	processed_at: Date | null
	error: string | null
	retry_count: number
}

export const WEBHOOK_REPOSITORY = Symbol('WEBHOOK_REPOSITORY')

export interface WebhookRepository {
	findWebhookEvent(eventId: string): Promise<WebhookEventRecord | null>
	upsertWebhookEvent(data: {
		event_id: string
		provider: string
		event_type: string
		payload: unknown
	}): Promise<WebhookEventRecord>
	markWebhookProcessed(id: number): Promise<void>
	markWebhookError(id: number, error: string): Promise<void>

	findSubscriptionByProviderId(providerSubscriptionId: string): Promise<{
		id: number
		plan_type: string
	} | null>
	updateSubscriptionById(id: number, data: Record<string, unknown>): Promise<void>
	updateSubscriptionsByProviderId(
		providerSubscriptionId: string,
		data: Record<string, unknown>,
	): Promise<void>
}
