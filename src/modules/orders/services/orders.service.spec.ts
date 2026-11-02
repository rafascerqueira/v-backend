import { NotFoundException } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { OutboxRelayService } from '@/shared/events/outbox-relay.service'
import { hashRequest } from '@/shared/idempotency/request-hash'
import { ORDER_REPOSITORY } from '@/shared/repositories/order.repository'
import { TenantContext } from '@/shared/tenant/tenant.context'
import { CustomersService } from '../../customers/services/customers.service'
import { ORDER_IDEMPOTENCY_SCOPES, OrdersService } from './orders.service'

/** Placeholder in the tracking-token format (22 chars). Zero entropy on purpose: secret scanners. */
const TRACKING_TOKEN = 'x'.repeat(22)

const repositoryMock = {
	create: jest.fn(),
	addItem: jest.fn(),
	findById: jest.fn(),
	findAll: jest.fn(),
	updateStatus: jest.fn(),
	delete: jest.fn(),
	findEvents: jest.fn(),
}

const outboxRelayMock = { kick: jest.fn(), relayPending: jest.fn() }

const tenantContextMock = {
	getSellerId: jest.fn().mockReturnValue('test-seller-id'),
	requireSellerId: jest.fn().mockReturnValue('test-seller-id'),
	isAdmin: jest.fn().mockReturnValue(false),
}

const customersServiceMock = {
	findOne: jest.fn(),
}

const monthlyCustomer = { billing_mode: 'monthly', billing_day: 5 }

describe('OrdersService', () => {
	let service: OrdersService

	beforeEach(async () => {
		const module = await Test.createTestingModule({
			providers: [
				OrdersService,
				{ provide: ORDER_REPOSITORY, useValue: repositoryMock },
				{ provide: TenantContext, useValue: tenantContextMock },
				{ provide: CustomersService, useValue: customersServiceMock },
				{ provide: OutboxRelayService, useValue: outboxRelayMock },
			],
		}).compile()

		service = module.get(OrdersService)
		jest.clearAllMocks()
		customersServiceMock.findOne.mockResolvedValue(monthlyCustomer)
		repositoryMock.create.mockResolvedValue({ orderId: 1, replayed: false })
		repositoryMock.findById.mockImplementation(async (id: number) => ({
			id,
			order_number: 'PED-000001',
		}))
	})

	describe('create (dashboard)', () => {
		const dto = {
			customer_id: 'cuid123',
			items: [
				{ product_id: 1, quantity: 2, unit_price: 1000, discount: 0 },
				{ product_id: 2, quantity: 1, unit_price: 500, discount: 100 },
			],
		}

		it('computes totals, writes through the repository and returns the stored order', async () => {
			const res = await service.create(dto as any)

			const call = repositoryMock.create.mock.calls[0][0]
			expect(call).toMatchObject({
				seller_id: 'test-seller-id',
				customer_id: 'cuid123',
				subtotal: 2500,
				discount: 100,
				total: 2400,
				source: 'dashboard',
				allowOversell: true,
			})
			expect(call.items).toHaveLength(2)
			// monthly customer — no per_sale charge attached (periodic mode handled by sync)
			expect(call.billing).toBeUndefined()
			expect(call.idempotency).toBeUndefined()
			expect(repositoryMock.findById).toHaveBeenCalledWith(1)
			expect(res).toEqual({ id: 1, order_number: 'PED-000001' })
		})

		it('ignores a client-sent order_number: the server numbers the order', async () => {
			await service.create({ ...dto, order_number: 'PED-CLIENT-1' } as any)

			const call = repositoryMock.create.mock.calls[0][0]
			expect(call).not.toHaveProperty('order_number')
			expect(JSON.stringify(call)).not.toContain('PED-CLIENT-1')
		})

		it('kicks the outbox relay after the commit so notifications go out right away', async () => {
			await service.create(dto as any)

			expect(outboxRelayMock.kick).toHaveBeenCalledTimes(1)
		})

		it('attaches a per_sale charge (numbered in the transaction) to the same write', async () => {
			customersServiceMock.findOne.mockResolvedValueOnce({
				billing_mode: 'per_sale',
				billing_day: null,
			})

			await service.create({
				customer_id: 'cuid-ps',
				items: [{ product_id: 1, quantity: 1, unit_price: 5000, discount: 0 }],
			} as any)

			const call = repositoryMock.create.mock.calls[0][0]
			expect(call.billing).toEqual(
				expect.objectContaining({
					total_amount: 5000,
					paid_amount: 0,
					payment_method: 'cash',
					payment_status: 'pending',
					status: 'pending',
				}),
			)
			expect(call.billing).not.toHaveProperty('billing_number')
			// per_sale: the sale date is the due date — never a null that renders as 01/01/1970
			expect(call.billing.due_date).toBeInstanceOf(Date)
		})

		it('clamps a line discount that exceeds the line value so totals never go negative', async () => {
			await service.create({
				customer_id: 'cuid-clamp',
				items: [{ product_id: 1, quantity: 2, unit_price: 1000, discount: 5000 }],
			} as any)

			const call = repositoryMock.create.mock.calls[0][0]
			// line value = 1000 * 2 = 2000; discount clamped from 5000 down to 2000
			expect(call.subtotal).toBe(2000)
			expect(call.discount).toBe(2000)
			expect(call.total).toBe(0)
			expect(call.items[0]).toMatchObject({ discount: 2000, total: 0 })
		})

		describe('Idempotency-Key', () => {
			it('passes the key, its scope and the hash of the body (minus order_number)', async () => {
				await service.create({ ...dto, order_number: 'PED-OLD-CLIENT' } as any, 'key-1')

				expect(repositoryMock.create.mock.calls[0][0].idempotency).toEqual({
					scope: ORDER_IDEMPOTENCY_SCOPES.dashboard,
					key: 'key-1',
					requestHash: hashRequest(dto),
				})
			})

			it('hashes the same body the same way even if an old client resends another number', async () => {
				await service.create({ ...dto, order_number: 'PED-A' } as any, 'key-1')
				await service.create({ ...dto, order_number: 'PED-B' } as any, 'key-1')

				const [first, second] = repositoryMock.create.mock.calls.map((c) => c[0].idempotency)
				expect(first.requestHash).toBe(second.requestHash)
			})

			it('returns the original order on a replay, without kicking the relay again', async () => {
				repositoryMock.create.mockResolvedValueOnce({ orderId: 42, replayed: true })

				const res = await service.create(dto as any, 'key-1')

				expect(repositoryMock.findById).toHaveBeenCalledWith(42)
				expect(res).toMatchObject({ id: 42 })
				expect(outboxRelayMock.kick).not.toHaveBeenCalled()
			})
		})
	})

	describe('place (storefront)', () => {
		it('never oversells and forwards metadata and the tracking token', async () => {
			await service.place({
				customerId: 'c1',
				items: [{ product_id: 1, quantity: 1, unit_price: 1000, discount: 0 }],
				source: 'storefront',
				metadata: { source: 'catalog' },
				trackingToken: TRACKING_TOKEN,
			})

			expect(repositoryMock.create.mock.calls[0][0]).toMatchObject({
				source: 'storefront',
				allowOversell: false,
				metadata: { source: 'catalog' },
				tracking_token: TRACKING_TOKEN,
			})
		})
	})

	it('addItem should compute total and delegate to repository', async () => {
		repositoryMock.addItem.mockResolvedValueOnce({ id: 10 })
		const res = await service.addItem(1, {
			product_id: 3,
			quantity: 2,
			unit_price: 300,
			discount: 50,
		} as any)
		expect(repositoryMock.addItem).toHaveBeenCalledWith({
			order_id: 1,
			product_id: 3,
			quantity: 2,
			unit_price: 300,
			discount: 50,
			total: 550,
		})
		expect(res).toEqual({ id: 10 })
	})

	it('addItem clamps a discount that exceeds the line value', async () => {
		repositoryMock.addItem.mockResolvedValueOnce({ id: 11 })
		await service.addItem(1, {
			product_id: 3,
			quantity: 1,
			unit_price: 300,
			discount: 9999,
		} as any)
		expect(repositoryMock.addItem).toHaveBeenCalledWith({
			order_id: 1,
			product_id: 3,
			quantity: 1,
			unit_price: 300,
			discount: 300,
			total: 0,
		})
	})

	it('findById delegates to repository', async () => {
		repositoryMock.findById.mockResolvedValueOnce({ id: 1, seller_id: 'test-seller-id' })
		const res = await service.findById(1)
		expect(repositoryMock.findById).toHaveBeenCalledWith(1)
		expect(res).toEqual({ id: 1, seller_id: 'test-seller-id' })
	})

	it('findAll delegates to repository', async () => {
		repositoryMock.findAll.mockResolvedValueOnce([{ id: 1 }])
		const res = await service.findAll()
		expect(repositoryMock.findAll).toHaveBeenCalledWith({})
		expect(res).toEqual([{ id: 1 }])
	})

	describe('findEvents', () => {
		it("returns the order's timeline", async () => {
			const events = [
				{ id: 'e1', event_type: 'order.created', occurred_at: new Date(), payload: {} },
			]
			repositoryMock.findEvents.mockResolvedValueOnce(events)

			await expect(service.findEvents(3)).resolves.toBe(events)
		})

		it('404s for a missing or foreign order', async () => {
			repositoryMock.findEvents.mockResolvedValueOnce(null)

			await expect(service.findEvents(3)).rejects.toBeInstanceOf(NotFoundException)
		})
	})

	it('updateStatus canceled should propagate cancellation to billing and kick the relay', async () => {
		repositoryMock.updateStatus.mockResolvedValueOnce({ id: 3, status: 'canceled' })

		await service.updateStatus(3, 'canceled')

		expect(repositoryMock.updateStatus).toHaveBeenCalledWith(3, 'canceled', {
			status: 'canceled',
			payment_status: 'canceled',
		})
		expect(outboxRelayMock.kick).toHaveBeenCalledTimes(1)
	})

	it('updateStatus delivered should NOT auto-mark billing as paid', async () => {
		repositoryMock.updateStatus.mockResolvedValueOnce({ id: 4, status: 'delivered' })

		await service.updateStatus(4, 'delivered')

		expect(repositoryMock.updateStatus).toHaveBeenCalledWith(4, 'delivered', undefined)
	})

	it('delete delegates to repository (tenant/404/409 enforced in the repo)', async () => {
		repositoryMock.delete.mockResolvedValueOnce({ id: 5 })
		const res = await service.delete(5)
		expect(repositoryMock.delete).toHaveBeenCalledWith(5)
		expect(res).toEqual({ id: 5 })
		expect(outboxRelayMock.kick).toHaveBeenCalledTimes(1)
	})
})
