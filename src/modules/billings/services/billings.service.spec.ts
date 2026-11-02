import { BadRequestException, NotFoundException } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { OutboxRelayService } from '@/shared/events/outbox-relay.service'
import { hashRequest } from '@/shared/idempotency/request-hash'
import { RedisService } from '@/shared/redis/redis.service'
import { BILLING_REPOSITORY } from '@/shared/repositories/billing.repository'
import { BILLING_PAYMENT_REPOSITORY } from '@/shared/repositories/billing-payment.repository'
import { TenantContext } from '@/shared/tenant/tenant.context'
import { BILLING_PAYMENT_SCOPES, BillingsService, LEGACY_PAYMENT_NOTES } from './billings.service'

const repositoryMock = {
	findAll: jest.fn(),
	findByOrderId: jest.fn(),
	findById: jest.fn(),
	findUnbilledPerSaleOrders: jest.fn(),
	create: jest.fn(),
	update: jest.fn(),
	delete: jest.fn(),
	verifyOrderAccess: jest.fn(),
}

const paymentsMock = { record: jest.fn(), reverse: jest.fn(), list: jest.fn() }
const outboxMock = { kick: jest.fn(), relayPending: jest.fn() }

const tenantContextMock = {
	getSellerId: jest.fn(),
	requireSellerId: jest.fn(),
	isAdmin: jest.fn(),
}

const redisMock = { delete: jest.fn() }

const billing = (over: Record<string, unknown> = {}) => ({
	id: 1,
	order_id: 2,
	billing_number: 'COB-000001',
	total_amount: 10000,
	paid_amount: 4000,
	payment_method: 'pix',
	payment_status: 'pending',
	status: 'partial',
	due_date: null,
	payment_date: null,
	...over,
})

const entry = { id: 9, billing_id: 1, kind: 'payment', amount: 1500 }

describe('BillingsService', () => {
	let service: BillingsService

	beforeEach(async () => {
		jest.resetAllMocks()
		tenantContextMock.getSellerId.mockReturnValue('test-seller-id')
		tenantContextMock.requireSellerId.mockReturnValue('test-seller-id')
		tenantContextMock.isAdmin.mockReturnValue(false)
		redisMock.delete.mockResolvedValue(undefined)

		const module = await Test.createTestingModule({
			providers: [
				BillingsService,
				{ provide: BILLING_REPOSITORY, useValue: repositoryMock },
				{ provide: BILLING_PAYMENT_REPOSITORY, useValue: paymentsMock },
				{ provide: TenantContext, useValue: tenantContextMock },
				{ provide: RedisService, useValue: redisMock },
				{ provide: OutboxRelayService, useValue: outboxMock },
			],
		}).compile()

		service = module.get(BillingsService)
	})

	it('listByOrder should delegate to repository', async () => {
		repositoryMock.findByOrderId.mockResolvedValueOnce([])
		await expect(service.listByOrder(1)).resolves.toEqual([])
		expect(repositoryMock.findByOrderId).toHaveBeenCalledWith(1, {})
	})

	describe('create (POST /orders/:id/billings)', () => {
		const dto = {
			billing_number: 'B-1',
			total_amount: 10000,
			paid_amount: 0,
			payment_method: 'cash' as const,
			due_date: '2026-11-30T00:00:00.000Z',
		}

		it('creates an unpaid charge, status derived from the amounts', async () => {
			repositoryMock.verifyOrderAccess.mockResolvedValueOnce({ id: 2, seller_id: 'test-seller-id' })
			repositoryMock.create.mockResolvedValueOnce({ id: 1 })

			const res = await service.create(2, dto)

			expect(repositoryMock.create).toHaveBeenCalledWith({
				order_id: 2,
				billing_number: 'B-1',
				total_amount: 10000,
				paid_amount: 0,
				payment_method: 'cash',
				status: 'pending',
				payment_status: 'pending',
				due_date: new Date('2026-11-30T00:00:00.000Z'),
			})
			expect(paymentsMock.record).not.toHaveBeenCalled()
			expect(res).toEqual({ id: 1 })
		})

		it('turns an amount already paid into the first ledger entry', async () => {
			repositoryMock.verifyOrderAccess.mockResolvedValueOnce({ id: 2, seller_id: 'test-seller-id' })
			repositoryMock.create.mockResolvedValueOnce({ id: 1 })
			repositoryMock.findById.mockResolvedValueOnce(billing({ paid_amount: 2500 }))
			paymentsMock.record.mockResolvedValueOnce({ entry, replayed: false })

			const res = await service.create(2, {
				...dto,
				paid_amount: 2500,
				payment_date: '2026-11-01T12:00:00.000Z',
			} as any)

			// The charge itself starts at zero: money only enters through the ledger.
			expect(repositoryMock.create.mock.calls[0][0]).toMatchObject({ paid_amount: 0 })
			expect(paymentsMock.record).toHaveBeenCalledWith({
				billingId: 1,
				amount: 2500,
				method: 'cash',
				paidAt: new Date('2026-11-01T12:00:00.000Z'),
				note: LEGACY_PAYMENT_NOTES.create,
				createdBy: 'test-seller-id',
			})
			expect(res).toMatchObject({ paid_amount: 2500 })
		})

		it('404s when the order is not the tenant’s', async () => {
			repositoryMock.verifyOrderAccess.mockResolvedValueOnce(null)
			await expect(service.create(2, dto)).rejects.toBeInstanceOf(NotFoundException)
		})

		it('400s when paid_amount exceeds total_amount', async () => {
			repositoryMock.verifyOrderAccess.mockResolvedValueOnce({ id: 2, seller_id: 'test-seller-id' })
			await expect(service.create(2, { ...dto, paid_amount: 20000 })).rejects.toBeInstanceOf(
				BadRequestException,
			)
		})
	})

	describe('update (PATCH, paid_amount deprecated)', () => {
		beforeEach(() => {
			repositoryMock.findById.mockResolvedValue(billing())
			paymentsMock.record.mockResolvedValue({ entry, replayed: false })
		})

		it('404s for a missing/cross-tenant billing (findById is tenant-scoped)', async () => {
			repositoryMock.findById.mockResolvedValueOnce(null)
			await expect(service.update(1, {})).rejects.toBeInstanceOf(NotFoundException)
			expect(repositoryMock.update).not.toHaveBeenCalled()
		})

		it('records a higher paid_amount as a ledger payment of the difference', async () => {
			await service.update(1, {
				paid_amount: 6500,
				payment_date: '2026-11-02T10:00:00.000Z',
			})

			expect(paymentsMock.record).toHaveBeenCalledWith({
				billingId: 1,
				amount: 2500,
				method: 'pix',
				paidAt: new Date('2026-11-02T10:00:00.000Z'),
				note: LEGACY_PAYMENT_NOTES.patch,
				createdBy: 'test-seller-id',
			})
			// paid_amount is never written directly anymore.
			expect(repositoryMock.update.mock.calls[0][1]).not.toHaveProperty('paid_amount')
			expect(repositoryMock.update.mock.calls[0][1]).not.toHaveProperty('payment_date')
			expect(outboxMock.kick).toHaveBeenCalled()
		})

		it('refuses a lower paid_amount: money only goes back through a reversal', async () => {
			await expect(service.update(1, { paid_amount: 1000 })).rejects.toThrow(/estorne/)
			expect(repositoryMock.update).not.toHaveBeenCalled()
			expect(paymentsMock.record).not.toHaveBeenCalled()
		})

		it('refuses paid above the total, and a total below what was already paid', async () => {
			await expect(service.update(1, { paid_amount: 12000 })).rejects.toBeInstanceOf(
				BadRequestException,
			)
			await expect(service.update(1, { total_amount: 3000 })).rejects.toThrow(
				/abaixo do valor já pago/,
			)
			expect(repositoryMock.update).not.toHaveBeenCalled()
		})

		it('refuses a payment on a canceled charge', async () => {
			repositoryMock.findById.mockResolvedValue(billing({ status: 'canceled' }))
			await expect(service.update(1, { paid_amount: 5000 })).rejects.toThrow(/cancelada/)
			expect(repositoryMock.update).not.toHaveBeenCalled()
		})

		it('edits the other fields, re-deriving status from paid vs the new total', async () => {
			await service.update(1, { total_amount: 4000, due_date: null, notes: 'x' })

			expect(repositoryMock.update).toHaveBeenCalledWith(1, {
				total_amount: 4000,
				notes: 'x',
				status: 'paid',
				payment_status: 'confirmed',
				due_date: null,
			})
			expect(paymentsMock.record).not.toHaveBeenCalled()
		})

		it('keeps a canceled charge canceled when editing other fields', async () => {
			repositoryMock.findById.mockResolvedValue(billing({ status: 'canceled' }))

			await service.update(1, { notes: 'x' })

			expect(repositoryMock.update.mock.calls[0][1]).not.toHaveProperty('status')
		})
	})

	describe('syncBillings', () => {
		it('numbers the charge COB-n for a server-numbered PED-n, legacy orders keep theirs', async () => {
			repositoryMock.findUnbilledPerSaleOrders.mockResolvedValueOnce([
				{ id: 5, order_number: 'PED-000123', total: 1000, createdAt: new Date() },
				{ id: 6, order_number: 'PED-202611-1234', total: 2000, createdAt: new Date() },
			])
			repositoryMock.create.mockResolvedValue({ id: 1 })

			const res = await service.syncBillings()

			expect(repositoryMock.create.mock.calls.map((c) => c[0].billing_number)).toEqual([
				'COB-000123',
				'PED-202611-1234',
			])
			expect(res).toEqual({ created: 2, orders: ['COB-000123', 'PED-202611-1234'] })
		})

		it('returns empty when nothing is unbilled', async () => {
			repositoryMock.findUnbilledPerSaleOrders.mockResolvedValueOnce([])
			await expect(service.syncBillings()).resolves.toEqual({ created: 0, orders: [] })
		})
	})

	describe('findAll', () => {
		it('passes a status filter through, except overdue', async () => {
			repositoryMock.findAll.mockResolvedValueOnce([])
			await service.findAll('paid')
			expect(repositoryMock.findAll).toHaveBeenCalledWith({ status: 'paid' })
		})

		it('computes overdue in memory', async () => {
			repositoryMock.findAll.mockResolvedValueOnce([{ status: 'overdue' }, { status: 'pending' }])
			await expect(service.findAll('overdue')).resolves.toEqual([{ status: 'overdue' }])
			expect(repositoryMock.findAll).toHaveBeenCalledWith({})
		})
	})

	describe('cancel', () => {
		it('voids a billing the tenant owns', async () => {
			repositoryMock.findById.mockResolvedValueOnce(billing())
			repositoryMock.update.mockResolvedValueOnce(billing({ status: 'canceled' }))

			await service.cancel(1)

			expect(repositoryMock.update).toHaveBeenCalledWith(1, {
				status: 'canceled',
				payment_status: 'canceled',
			})
		})

		it('404s for a missing/cross-tenant billing and never writes', async () => {
			repositoryMock.findById.mockResolvedValueOnce(null)
			await expect(service.cancel(1)).rejects.toBeInstanceOf(NotFoundException)
			expect(repositoryMock.update).not.toHaveBeenCalled()
		})
	})

	describe('delete', () => {
		it('delegates to the repository (404 / 409 HAS_PAYMENTS enforced there)', async () => {
			repositoryMock.delete.mockResolvedValueOnce(undefined)

			await service.delete(1)

			expect(repositoryMock.delete).toHaveBeenCalledWith(1)
			expect(redisMock.delete).toHaveBeenCalledWith('dashboard:stats:test-seller-id')
		})
	})

	describe('ledger endpoints', () => {
		beforeEach(() => {
			repositoryMock.findById.mockResolvedValue(billing({ paid_amount: 5500 }))
		})

		it('recordPayment: the caller is the author, paid_at defaults to now', async () => {
			paymentsMock.record.mockResolvedValueOnce({ entry, replayed: false })
			const before = Date.now()

			const res = await service.recordPayment(1, { amount: 1500, method: 'pix' })

			const input = paymentsMock.record.mock.calls[0][0]
			expect(input).toMatchObject({
				billingId: 1,
				amount: 1500,
				method: 'pix',
				createdBy: 'test-seller-id',
			})
			expect(input.paidAt.getTime()).toBeGreaterThanOrEqual(before)
			expect(input.idempotency).toBeUndefined()
			expect(res).toEqual({ payment: entry, billing: billing({ paid_amount: 5500 }) })
			expect(redisMock.delete).toHaveBeenCalled()
			expect(outboxMock.kick).toHaveBeenCalled()
		})

		it('recordPayment: refuses a paid_at in the future', async () => {
			await expect(
				service.recordPayment(1, {
					amount: 1500,
					method: 'pix',
					paid_at: new Date(Date.now() + 86_400_000).toISOString(),
				}),
			).rejects.toThrow(/futuro/)
			expect(paymentsMock.record).not.toHaveBeenCalled()
		})

		it('recordPayment: forwards the Idempotency-Key; a replay has no side effects', async () => {
			paymentsMock.record.mockResolvedValueOnce({ entry, replayed: true })
			const dto = { amount: 1500, method: 'pix' as const }

			await service.recordPayment(1, dto, 'key-1234567890abcdef')

			expect(paymentsMock.record.mock.calls[0][0].idempotency).toEqual({
				scope: BILLING_PAYMENT_SCOPES.record,
				key: 'key-1234567890abcdef',
				requestHash: hashRequest({ billingId: 1, ...dto }),
			})
			expect(redisMock.delete).not.toHaveBeenCalled()
			expect(outboxMock.kick).not.toHaveBeenCalled()
		})

		it('reversePayment: returns the reversal and the updated charge', async () => {
			const reversal = { ...entry, id: 10, kind: 'reversal', reversal_of_id: 9 }
			paymentsMock.reverse.mockResolvedValueOnce({ entry: reversal, replayed: false })

			const res = await service.reversePayment(1, 9, { reason: 'Lançado em duplicidade' })

			expect(paymentsMock.reverse).toHaveBeenCalledWith({
				billingId: 1,
				paymentId: 9,
				reason: 'Lançado em duplicidade',
				createdBy: 'test-seller-id',
				idempotency: undefined,
			})
			expect(res).toEqual({ reversal, billing: billing({ paid_amount: 5500 }) })
		})

		it('listPayments: 404 for a missing/cross-tenant charge', async () => {
			paymentsMock.list.mockResolvedValueOnce(null)
			await expect(service.listPayments(1)).rejects.toBeInstanceOf(NotFoundException)
		})
	})
})
