import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import type { TestingModule } from '@nestjs/testing'
import { appendDomainEvents } from '../src/shared/events/append-domain-events'
import {
	DOMAIN_EVENT_TYPES,
	type DomainEvent,
	domainEffectDedupeKey,
	type NewDomainEvent,
} from '../src/shared/events/domain-event.types'
import { DomainEventHandlerRegistry } from '../src/shared/events/domain-event-handler.registry'
import { OutboxProcessor } from '../src/shared/events/outbox.processor'
import { OutboxRelayService } from '../src/shared/events/outbox-relay.service'
import type { PrismaService } from '../src/shared/prisma/prisma.service'
import {
	DOMAIN_EVENT_REPOSITORY,
	type DomainEventRepository,
} from '../src/shared/repositories/domain-event.repository'
import {
	IDEMPOTENCY_KEY_REPOSITORY,
	type IdempotencyKeyRepository,
} from '../src/shared/repositories/idempotency-key.repository'
import { TenantContext } from '../src/shared/tenant/tenant.context'
import { NotificationService } from '../src/shared/websocket/notification.service'
import { createE2EApp, seedTestSeller, TEST_SELLER } from './helpers/e2e'

/**
 * Outbox (Phase 1B) against real Postgres + Redis: events commit or roll back with
 * the business write, the relay hands each one to its handlers through BullMQ with
 * the tenant context set, re-publishing never re-runs an effect, concurrent relays
 * never take the same rows (FOR UPDATE SKIP LOCKED), and consumers dedupe.
 *
 * The scheduled relay worker is paused so only the explicit relay calls below
 * publish; the effect worker runs normally.
 */
describe('Outbox (e2e)', () => {
	let app: NestFastifyApplication
	let prisma: PrismaService
	let module: TestingModule
	let relay: OutboxRelayService

	const handled: Array<{ event: DomainEvent; tenant: string | undefined }> = []
	const HANDLER = 'e2e-recorder'
	const NOTIFIER = 'e2e-notifier'

	const orderCreated = (orderId: number): NewDomainEvent => ({
		sellerId: TEST_SELLER.id,
		aggregateType: 'order',
		aggregateId: orderId,
		eventType: DOMAIN_EVENT_TYPES.ORDER_CREATED,
		payload: { orderId, total: 1990 },
	})

	const waitFor = async (condition: () => Promise<boolean> | boolean, timeoutMs = 10_000) => {
		const deadline = Date.now() + timeoutMs
		while (!(await condition())) {
			if (Date.now() > deadline) throw new Error('Timed out waiting for the condition')
			await new Promise((resolve) => setTimeout(resolve, 100))
		}
	}

	const cleanDb = async () => {
		await prisma.domainEvent.deleteMany({})
		await prisma.notification.deleteMany({ where: { user_id: TEST_SELLER.id } })
		await prisma.idempotencyKey.deleteMany({ where: { seller_id: TEST_SELLER.id } })
	}

	beforeAll(async () => {
		;({ app, prisma, module } = await createE2EApp())
		await seedTestSeller(prisma)
		await module.get(OutboxProcessor).worker.pause()
		relay = module.get(OutboxRelayService)

		const registry = module.get(DomainEventHandlerRegistry)
		const tenantContext = module.get(TenantContext)
		const notifications = module.get(NotificationService)
		registry.register({
			name: HANDLER,
			eventTypes: [DOMAIN_EVENT_TYPES.ORDER_CREATED],
			handle: async (event) => {
				handled.push({ event, tenant: tenantContext.getSellerId() })
			},
		})
		registry.register({
			name: NOTIFIER,
			eventTypes: [DOMAIN_EVENT_TYPES.STOCK_MOVED],
			handle: async (event) => {
				await notifications.create({
					userId: TEST_SELLER.id,
					type: 'info',
					title: 'Reposição alocada',
					message: 'e2e',
					dedupeKey: domainEffectDedupeKey(event, NOTIFIER),
				})
			},
		})
	})

	beforeEach(async () => {
		handled.length = 0
		await cleanDb()
	})

	afterAll(async () => {
		await cleanDb()
		await app.close()
	})

	it('relays an event committed with its write to the handler, inside the tenant context', async () => {
		await prisma.$transaction((tx) => appendDomainEvents(tx, [orderCreated(101)]))

		const result = await relay.relayPending()
		await waitFor(() => handled.length === 1)

		expect(result).toEqual({ published: 1, failed: 0 })
		expect(handled[0].event).toMatchObject({
			sellerId: TEST_SELLER.id,
			aggregateType: 'order',
			aggregateId: '101',
			eventType: 'order.created',
			payload: { orderId: 101, total: 1990 },
		})
		expect(handled[0].tenant).toBe(TEST_SELLER.id)

		const stored = await prisma.domainEvent.findFirstOrThrow()
		expect(stored.published_at).not.toBeNull()
		expect(stored.attempts).toBe(0)
	})

	it('stores nothing when the business transaction rolls back', async () => {
		await expect(
			prisma.$transaction(async (tx) => {
				await appendDomainEvents(tx, [orderCreated(102)])
				throw new Error('business write failed')
			}),
		).rejects.toThrow('business write failed')

		expect(await prisma.domainEvent.count()).toBe(0)
		expect(await relay.relayPending()).toEqual({ published: 0, failed: 0 })
	})

	it('does not re-run an effect when the same event is published again', async () => {
		await prisma.$transaction((tx) => appendDomainEvents(tx, [orderCreated(103)]))
		await relay.relayPending()
		await waitFor(() => handled.length === 1)

		// Simulate a relay that crashed after enqueuing but before committing published_at.
		await prisma.domainEvent.updateMany({ data: { published_at: null } })
		expect(await relay.relayPending()).toEqual({ published: 1, failed: 0 })

		await new Promise((resolve) => setTimeout(resolve, 500))
		expect(handled).toHaveLength(1)
	})

	it('never lets two concurrent relays take the same event (FOR UPDATE SKIP LOCKED)', async () => {
		await prisma.$transaction((tx) =>
			appendDomainEvents(
				tx,
				Array.from({ length: 20 }, (_, i) => orderCreated(200 + i)),
			),
		)
		const repository = module.get<DomainEventRepository>(DOMAIN_EVENT_REPOSITORY)
		const seen: string[] = []
		const slowPublish = async (event: DomainEvent) => {
			seen.push(event.id)
			await new Promise((resolve) => setTimeout(resolve, 10))
		}

		const [a, b] = await Promise.all([
			repository.relayPending(15, slowPublish),
			repository.relayPending(15, slowPublish),
		])

		expect(new Set(seen).size).toBe(seen.length)
		expect(a.published + b.published).toBe(20)
		expect(await prisma.domainEvent.count({ where: { published_at: null } })).toBe(0)
	})

	it('records failed publishes and keeps the event pending for the next run', async () => {
		await prisma.$transaction((tx) => appendDomainEvents(tx, [orderCreated(104)]))
		const repository = module.get<DomainEventRepository>(DOMAIN_EVENT_REPOSITORY)

		const result = await repository.relayPending(10, async () => {
			throw new Error('redis down')
		})

		expect(result.failures).toEqual([
			expect.objectContaining({ eventType: 'order.created', attempts: 1, error: 'redis down' }),
		])
		const stored = await prisma.domainEvent.findFirstOrThrow()
		expect(stored).toMatchObject({ published_at: null, attempts: 1, last_error: 'redis down' })

		expect(await relay.relayPending()).toEqual({ published: 1, failed: 0 })
		await waitFor(() => handled.length === 1)
	})

	it('a consumer with a dedupe key notifies once even if its effect runs twice', async () => {
		await prisma.$transaction((tx) =>
			appendDomainEvents(tx, [
				{
					sellerId: TEST_SELLER.id,
					aggregateType: 'stock',
					aggregateId: 7,
					eventType: DOMAIN_EVENT_TYPES.STOCK_MOVED,
					payload: { productId: 7 },
				},
			]),
		)
		await relay.relayPending()
		await waitFor(
			async () => (await prisma.notification.count({ where: { user_id: TEST_SELLER.id } })) === 1,
		)

		// A second delivery of the same effect (e.g. after the BullMQ job was evicted).
		const event = await prisma.domainEvent.findFirstOrThrow()
		await module.get(NotificationService).create({
			userId: TEST_SELLER.id,
			type: 'info',
			title: 'Reposição alocada',
			message: 'e2e',
			dedupeKey: domainEffectDedupeKey({ id: event.id }, NOTIFIER),
		})

		expect(await prisma.notification.count({ where: { user_id: TEST_SELLER.id } })).toBe(1)
	})

	it('purges idempotency keys older than the cutoff, keeping recent ones', async () => {
		const key = (name: string, createdAt: Date) => ({
			seller_id: TEST_SELLER.id,
			scope: 'orders.create',
			key: name,
			request_hash: 'h',
			resource_type: 'order',
			resource_id: '1',
			status_code: 201,
			created_at: createdAt,
		})
		await prisma.idempotencyKey.createMany({
			data: [key('old', new Date('2026-10-01T00:00:00Z')), key('new', new Date())],
		})

		const deleted = await module
			.get<IdempotencyKeyRepository>(IDEMPOTENCY_KEY_REPOSITORY)
			.deleteCreatedBefore(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000))

		expect(deleted).toBe(1)
		const remaining = await prisma.idempotencyKey.findMany({ where: { seller_id: TEST_SELLER.id } })
		expect(remaining.map((row) => row.key)).toEqual(['new'])
	})
})
